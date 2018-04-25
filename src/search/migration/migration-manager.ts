import noop from 'lodash/fp/noop'
import whenAllSettled from 'when-all-settled'

import exportOldPages, { ExportParams } from '../search-index-old/export'
import importNewPage from '../search-index-new/import'

export interface Props {
    concurrency: number
    onComplete: () => void
}

export class MigrationManager {
    private static DEF_PARAMS: ExportParams = {
        chunkSize: 10,
        startKey: 'page/',
        endKey: 'page/\uffff',
    }

    /**
     * Acts as a flag to stop iteration over old pages if ever set.
     */
    private isCancelled = false

    /**
     * Acts as a progress state, holding the page key to start iterating from.
     */
    private currKey = MigrationManager.DEF_PARAMS.startKey

    private concurrency: number
    private onComplete: () => void

    constructor({
        concurrency = MigrationManager.DEF_PARAMS.chunkSize,
        onComplete = noop,
    }: Partial<Props>) {
        this.concurrency = concurrency
        this.onComplete = onComplete
    }

    /**
     * Will reject if `stop()` method has been called. Will resolve when old
     * page data is exhausted.
     */
    private async migrate(opts: Partial<ExportParams>) {
        const exportParams = { ...MigrationManager.DEF_PARAMS, ...opts }

        for await (const { pages, lastKey } of exportOldPages(exportParams)) {
            this.currKey = lastKey

            // If `stop()` method has been called, throw error to signal to caller
            if (this.isCancelled) {
                this.isCancelled = false
                throw new Error()
            }

            await whenAllSettled(pages.map(importNewPage))
        }
    }

    /**
     * Starts migration from last recorded progress state.
     *
     * @returns A long running Promise that will resolve once migration is finished, or interrupted.
     */
    public start(concurrency = this.concurrency) {
        return this.migrate({ chunkSize: concurrency, startKey: this.currKey })
            .then(this.onComplete)
            .catch(noop) // Errors should only be from interruptions
    }

    /**
     * Schedules for the migration iterations to stop when next check happens (once per iteration).
     */
    public stop() {
        this.isCancelled = true
    }
}
