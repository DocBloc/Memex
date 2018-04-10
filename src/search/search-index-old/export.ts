import * as whenAllSettled from 'when-all-settled'

import db, { getAttachmentAsDataUrl } from '../../pouchdb'
import { ExportedPage, ExportedPageVisit } from '../migration'
import { removeKeyType, initLookupByKeys } from './util'
import index from './index'

export interface ExportParams {
    chunkSize: number
    startKey: string
    endKey: string
}

const DEF_PARAMS: ExportParams = {
    chunkSize: 10,
    startKey: 'page/',
    endKey: 'page/\uffff',
}

async function* exportPages(
    {
        chunkSize = DEF_PARAMS.chunkSize,
        startKey = DEF_PARAMS.startKey,
        endKey = DEF_PARAMS.endKey,
    }: Partial<ExportParams> = DEF_PARAMS,
) {
    let lastKey = startKey
    let batch: Map<string, any>

    do {
        // Get batch for current key + limit, then update the key for next iteration
        batch = await fetchIndexPageBatch(lastKey, chunkSize)
        lastKey = [...batch.keys()][batch.size - 1]

        // Process each key, fetching needed data, then yielding it to caller
        yield await whenAllSettled([...batch].map(processKey))
    } while (batch.size === chunkSize)
}

const fetchIndexPageBatch = (
    from: string,
    limit: number,
): Promise<Map<string, any>> =>
    new Promise((resolve, reject) => {
        const data = new Map<string, any>()
        ;(<any>index)
            .createReadStream({ gte: from, limit, keyAsBuffer: false })
            .on('data', ({ key, value }) => data.set(key, value))
            .on('error', err => reject(err))
            .on('end', () => resolve(data))
    })

async function processKey([key, indexDoc]: [string, any]) {
    const pouchDoc = await db.get(key)

    const screenshot = await getAttachmentAsDataUrl({
        doc: pouchDoc,
        attachmentId: 'screenshot',
    })
    const favIcon = await getAttachmentAsDataUrl({
        doc: pouchDoc,
        attachmentId: 'favicon',
    })

    // Grab all visit meta data
    let visits: ExportedPageVisit[]
    if (indexDoc.visits.size) {
        const lookupMap = await initLookupByKeys()([...indexDoc.visits])
        visits = [...lookupMap.values()]
    } else {
        visits = []
    }

    const page: ExportedPage = {
        url: pouchDoc.url,
        content: { ...pouchDoc.content },
        visits: visits,
        bookmark: indexDoc.bookmarks.size
            ? formatMetaKey([...indexDoc.bookmarks][0])
            : null,
        tags: [...indexDoc.tags].map(removeKeyType),
        screenshot,
        favIcon,
    }

    return page
}

const formatMetaKey = (key: string) => Number.parseInt(removeKeyType(key), 10)

export default exportPages
