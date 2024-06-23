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

export default new class Go2RTC {
    constructor() {
        this.started = false
        this.go2rtcProcess = false
    }

    async init(cameras) {
        this.started = true
        debug(chalk.green('-'.repeat(90)))
        debug('Creating go2rtc configuration and starting go2rtc process...')

        const configFile = (process.env.RUNMODE === 'standard')
            ? dirname(fileURLToPath(new URL('.', import.meta.url)))+'/config/go2rtc.yaml'
            : '/data/go2rtc.yaml'

        let config = {
            log: {
                level: 'debug',
                hass: 'info'
            },
            api: {
                listen: ''
            },
            srtp: {
                listen: ''
            },
            rtsp: {
                listen: ':8554',
                ...(utils.config().livestream_user && utils.config().livestream_pass)
                    ? {
                        username: utils.config().livestream_user,
                        password: utils.config().livestream_pass
                    } : {},
                default_query: 'video&audio=aac&audio=opus'
            },
            webrtc: {
                listen: ''
            }
        }

        if (cameras) {
            config.streams = {}
            for (const camera of cameras) {
                config.streams[`${camera.deviceId}_live`] =
                    `exec:${dirname(fileURLToPath(new URL('.', import.meta.url)))}/scripts/start-stream.sh ${camera.deviceId} live ${camera.deviceTopic} {output}#killsignal=15#killtimeout=5`
                config.streams[`${camera.deviceId}_event`] =
                    `exec:${dirname(fileURLToPath(new URL('.', import.meta.url)))}/scripts/start-stream.sh ${camera.deviceId} event ${camera.deviceTopic} {output}#killsignal=15#killtimeout=5`
            }
            try {
                await writeFileAtomic(configFile, yaml.dump(config, { lineWidth: -1 }))
                debug('Successfully wrote go2rtc configuration file: '+configFile)
            } catch (err) {
                debug(chalk.red('Failed to write go2rtc configuration file: '+configFile))
                debug(err.message)
            }
        }

        this.go2rtcProcess = spawn('go2rtc', ['-config', configFile], {
            env: process.env,   // set env vars
            cwd: '.',           // set cwd
            stdio: 'pipe'       // forward stdio options
        })

        this.go2rtcProcess.on('spawn', async () => {
            debug('The go2rtc process was started successfully')
            await utils.sleep(2) // Give the process a second to start the API server
            debug(chalk.green('-'.repeat(90)))
        })

        this.go2rtcProcess.on('close', async () => {
            await utils.sleep(1) // Delay to avoid spurious messages if shutting down
            if (this.started !== 'shutdown') {
                debug('The go2rtc process exited unexpectedly, will restart in 5 seconds...')
                this.go2rtcProcess.kill(9)  // Sometimes rtsp-simple-server crashes and doesn't exit completely, try to force kill it
                await utils.sleep(5)
                this.init()
            }
        })

        const stdoutLine = readline.createInterface({ input: this.go2rtcProcess.stdout })
        stdoutLine.on('line', (line) => {
            // Replace time in go2rtc log messages with tag
            debug(line.replace(/^.*\d{2}:\d{2}:\d{2}\.\d{3}([^\s]+) /, chalk.green('[go2rtc] ')))
        })

        const stderrLine = readline.createInterface({ input: this.go2rtcProcess.stderr })
        stderrLine.on('line', (line) => {
            // Replace time in go2rtc log messages with tag
            debug(line.replace(/^.*\d{2}:\d{2}:\d{2}\.\d{3}([^\s]+) /, '[go2rtc] '))
        })
    }

    shutdown() {
        this.started = 'shutdown'
        if (this.go2rtcProcess) {
            this.go2rtcProcess.kill()
            this.go2rtcProcess = false
        }
        return
    }
}
