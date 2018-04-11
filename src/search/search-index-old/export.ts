import whenAllSettled from 'when-all-settled'

import db from '../../pouchdb'
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

interface VisitMeta extends ExportedPageVisit {
    pageId: string
}

interface PageAttachments {
    screenshot: string
    favIcon: string
}

const attachmentToDataUrl = ({ content_type, data }) =>
    `data:${content_type};base64,${data}`

function extractAttachments(pouchDoc): Partial<PageAttachments> {
    if (!pouchDoc || !pouchDoc._attachments) {
        return {}
    }

    let favIcon, screenshot
    if (pouchDoc._attachments.screenshot) {
        screenshot = attachmentToDataUrl(pouchDoc._attachments.screenshot)
    }
    if (pouchDoc._attachments.favIcon) {
        favIcon = attachmentToDataUrl(pouchDoc._attachments.favIcon)
    }

    return { screenshot, favIcon }
}

async function processKey([pageKey, indexDoc]: [string, any]) {
    const pouchDoc = await db.get(pageKey, { attachments: true })
    const attachments = extractAttachments(pouchDoc)

    // Grab all visit meta data
    let visits: ExportedPageVisit[]
    if (indexDoc.visits.size) {
        const lookupMap: Map<string, VisitMeta> = await initLookupByKeys()([
            ...indexDoc.visits,
        ])

        // Reshape found visit index docs to ExportedPageVisit shape
        visits = [...lookupMap].map(([visitKey, { pageId, ...visit }]) => ({
            timestamp: formatMetaKey(visitKey),
            ...visit,
        }))
    } else {
        visits = []
    }

    const page: ExportedPage = {
        url: pouchDoc.url,
        content: { ...pouchDoc.content },
        visits: visits,
        bookmark: indexDoc.bookmarks.size
            ? formatMetaKey([...indexDoc.bookmarks][0])
            : undefined,
        tags: [...indexDoc.tags].map(removeKeyType),
        ...attachments,
    }

    return page
}

const formatMetaKey = (key: string) => Number.parseInt(removeKeyType(key), 10)

export default exportPages
