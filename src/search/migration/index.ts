import whenAllSettled from 'when-all-settled'

import exportOldPages from '../search-index-old/export'
import importNewPage from '../search-index-new/import'

window['exp'] = exportOldPages
window['imp'] = importNewPage
window['migrate'] = migrate

export interface MigrateOpts {
    concurrency: number
}

const DEF_OPTS: MigrateOpts = {
    concurrency: 10,
}

async function migrate({ concurrency = DEF_OPTS.concurrency } = DEF_OPTS) {
    for await (const pages of exportOldPages({ chunkSize: concurrency })) {
        await whenAllSettled(pages.map(importNewPage))
    }
}

export * from './types'
export default migrate
