import chalk from 'chalk'
import utils from './utils.js'
import { spawn } from 'child_process'
import readline from 'readline'
import yaml from 'js-yaml'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import writeFileAtomic from 'write-file-atomic'
import debugModule from 'debug'
const debug = debugModule('ring-rtsp')

export default new class MediaMTX {
    constructor() {
        this.started = false
        this.mediamtxProcess = false
    }

    async init(cameras) {
        this.started = true
        debug(chalk.green('-'.repeat(90)))
        debug('Creating mediamtx configuration and starting server process...')

        const configFile = (process.env.RUNMODE === 'standard')
            ? dirname(fileURLToPath(new URL('.', import.meta.url)))+'/config/mediamtx.yaml'
            : '/data/mediamtx.yaml'

        let config = {
            logLevel: 'info',
            logDestinations:  [ 'stdout' ],
            readTimeout: '10s',
            writeTimeout: '10s',
            writeQueueSize: 2048,
            api: false,
            pprof: false,
            playback: false,
            rtmp: false,
            hls: false,
            webrtc: false,
            srt: false,
            authInternalUsers: [
                {
                    user: 'any',
                    ips: [ '127.0.0.1' ],
                    permissions: [{ action: 'publish' }]
                },
                ...(utils.config().livestream_user && utils.config().livestream_pass)
                    ? [ {
                        user: utils.config().livestream_user,
                        pass: utils.config().livestream_pass,
                        ips: [],
                        permissions: [{ action: 'read' }]
                    }] : []
            ],
            rtsp: true,
            protocols: [ 'tcp' ],
            rtspAddress: ':8554',
            pathDefaults: {
                maxReaders: 50,
                record: false,
                overridePublisher: true,
                rtspTransport: 'tcp',
                runOnDemandStartTimeout: '10s',
                runOnDemandCloseAfter: '1s',
                runOnDemandRestart: true
            }
        }

        if (cameras) {
            config.paths = {}
            for (const camera of cameras) {
                config.paths[`${camera.deviceId}_live`] = {
                    runOnDemand: `"${dirname(fileURLToPath(new URL('.', import.meta.url)))}/scripts/start-stream.sh" ${camera.deviceId} live ${camera.deviceTopic} rtsp://127.0.0.1:8554/${camera.deviceId}_live`
                },
                config.paths[`${camera.deviceId}_event`] = {
                    runOnDemand: `"${dirname(fileURLToPath(new URL('.', import.meta.url)))}/scripts/start-stream.sh" ${camera.deviceId} live ${camera.deviceTopic} rtsp://127.0.0.1:8554/${camera.deviceId}_event`
                }
            }
            try {
                await writeFileAtomic(configFile, yaml.dump(config, { lineWidth: -1 }))
                debug('Successfully wrote mediamtx configuration file: '+configFile)
            } catch (err) {
                debug(chalk.red('Failed to write mediamtx configuration file: '+configFile))
                debug(err.message)
            }
        }

        this.mediamtxProcess = spawn('mediamtx', [configFile], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        this.mediamtxProcess.on('spawn', async () => {
            debug('The mediamtx process was started successfully')
            await utils.sleep(2) // Give the process a second to start the API server
            debug(chalk.green('-'.repeat(90)))
        })

        this.mediamtxProcess.on('close', async () => {
            await utils.sleep(1) // Delay to avoid spurious messages if shutting down
            if (this.started !== 'shutdown') {
                debug('The mediamtx process exited unexpectedly, will restart in 5 seconds...')
                this.mediamtxProcess.kill(9)  // Sometimes crashes and doesn't exit completely, try to force kill it
                await utils.sleep(5)
                this.init()
            }
        })

        const stdoutLine = readline.createInterface({ input: this.mediamtxProcess.stdout })
        stdoutLine.on('line', (line) => {
            // Replace time in mediamtx log messages with tag
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, chalk.green('[MediaMTX] ')))
        })

        const stderrLine = readline.createInterface({ input: this.mediamtxProcess.stderr })
        stderrLine.on('line', (line) => {
            // Replace time in mediamtx log messages with tag
            debug(line.replace(/\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} /g, chalk.green('[MediaMTX] ')))
        })
    }

    shutdown() {
        this.started = 'shutdown'
        if (this.mediamtxProcess) {
            this.mediamtxProcess.kill()
            this.mediamtxProcess = false
        }
        return
    }
}
