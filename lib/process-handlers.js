import chalk from 'chalk'
import utils from './utils.js'
import ring from './ring.js'
import debugModule from 'debug'
const debug = debugModule('ring-mqtt')

export default new class ProcessHandlers {
    constructor() {
        this.init()
    }

    init() {
        process.on('exit', this.processExit.bind(null, 0))
        process.on('SIGINT', this.processExit.bind(null, 0))
        process.on('SIGTERM', this.processExit.bind(null, 0))
        process.on('uncaughtException', (err) => {
            debug(chalk.red('ERROR - Uncaught Exception'))
            debug(chalk.red(err.message))
            debug(err.stack)
            this.processExit(2)
        })
        process.on('unhandledRejection', (err) => {
            switch(true) {
                // For these strings suppress the stack trace and only print the message
                case /token is not valid/.test(err.message):
                case /https:\/\/github.com\/dgreif\/ring\/wiki\/Refresh-Tokens/.test(err.message):
                case /error: access_denied/.test(err.message):
                    debug(chalk.yellow(err.message))
                    break;
                default:
                    debug(chalk.yellow('WARNING - Unhandled Promise Rejection'))
                    debug(chalk.yellow(err.message))
                    debug(err.stack)
            }
        })
    }

    // Set offline status on exit
    async processExit(exitCode) {
        await utils.sleep(1)
        debug('The ring-mqtt process is shutting down...')
        await ring.shutdown()
        await utils.sleep(2)
        if (exitCode || exitCode === 0) debug(`Exit code: ${exitCode}`);
        process.exit()
    }
}
