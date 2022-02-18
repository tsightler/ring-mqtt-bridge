const debug = require('debug')('ring-mqtt')
const colors = require('colors/safe')
const fs = require('fs')
const { createHash, randomBytes } = require('crypto')
const writeFileAtomic = require('write-file-atomic')

class State {
    constructor() {
        this.valid = false
        this.data = { 
            ring_token: '',
            systemId: '',
            devices: new Array()
        }
    }

    async init(config) {
        this.config = config
        this.file = (this.config.runMode === 'standard') 
            ? require('path').dirname(require.main.filename)+'/ring-state.json'
            : this.file = '/data/ring-state.json'
        await this.loadStateData()
    }

    async loadStateData() {
        if (fs.existsSync(this.file)) {
            debug('Reading latest data from state file: '+this.file)
            try {
                this.data = require(this.file)
                this.valid = true
                if (!this.data.hasOwnProperty('systemId')) {
                    this.data.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
                }
            } catch {
                debug(err.message)
                debug('Saved state file exist but could not be parsed!')
            }
        } else {
            debug(colors.brightYellow('File '+this.file+' not found. No saved state data available.'))
        }
    }

    // Save updated refresh token to config or state file
    async updateToken(newRefreshToken, oldRefreshToken) {
        if (oldRefreshToken) {
            this.data.ring_token = newRefreshToken

            try {
                await writeFileAtomic(this.file, JSON.stringify(this.data, null, 2))
                debug('Successfully saved updated refresh token in state file: '+this.file)
            } catch (err) {
                debug('Failed to save updated refresh token in state file: '+this.file)
                debug(err.message)
            }

            if (this.config.runMode === 'standard') {
                await this.config.updateConfig()
            }
        }
    }
}

module.exports = new State()