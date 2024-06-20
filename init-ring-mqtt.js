#!/usr/bin/env node
import fs from 'fs'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { readFile } from 'fs/promises'
import writeFileAtomic from 'write-file-atomic'
import { createHash, randomBytes } from 'crypto'
import { RingRestClient } from '@tsightler/ring-client-api/rest-client'
import { requestInput } from './node_modules/@tsightler/ring-client-api/lib/util.js'

async function getRefreshToken(systemId) {
    let generatedToken
    const email = await requestInput('Email: ')
    const password = await requestInput('Password: ')
    const restClient = new RingRestClient({
        email,
        password,
        controlCenterDisplayName: `ring-mqtt-${systemId.slice(-5)}`,
        systemId: systemId
    })
    try {
        await restClient.getCurrentAuth()
    } catch(err) {
        if (restClient.using2fa) {
            console.log('Username/Password was accepted, waiting for 2FA code to be entered.')
        } else {
            throw(err.message)
        }
    }

    while(!generatedToken) {
        const code = await requestInput('2FA Code: ')
        try {
            generatedToken = await restClient.getAuth(code)
            return generatedToken.refresh_token
        } catch(err) {
            throw('Failed to validate the entered 2FA code. (error: invalid_code)')
        }
    }
}

const main = async() => {
    let refresh_token
    let stateData = {}
    // If running in Docker set state file path as appropriate
    const stateFile = (fs.existsSync('/etc/cont-init.d/ring-mqtt.sh'))
        ? '/data/ring-state.json'
        : dirname(fileURLToPath(new URL(import.meta.url)))+'/ring-state.json'

    const configFile = (fs.existsSync('/etc/cont-init.d/ring-mqtt.sh'))
        ? '/data/config.json'
        : dirname(fileURLToPath(new URL(import.meta.url)))+'/config.json'

    if (fs.existsSync(stateFile)) {
        console.log('Reading latest data from state file: '+stateFile)
        try {
            stateData = JSON.parse(await readFile(stateFile))
        } catch(err) {
            console.log(err.message)
            console.log('Saved state file '+stateFile+' exist but could not be parsed!')
            console.log('To create new state file please rename/delete existing file and re-run this tool.')
            process.exit(1)
        }
    }

    if (!stateData.hasOwnProperty('systemId') || (stateData.hasOwnProperty('systemId') && !stateData.systemId)) {
        stateData.systemId = (createHash('sha256').update(randomBytes(32)).digest('hex'))
    }

    try {
        refresh_token = await getRefreshToken(stateData.systemId)
    } catch(err) {
        console.log(err)
        console.log('Please re-run this tool to retry authentication.')
        process.exit(1)
    }

    stateData.ring_token = refresh_token

    try {
        await writeFileAtomic(stateFile, JSON.stringify(stateData))
        console.log(`State file ${stateFile} saved with updated refresh token.`)
        console.log(`Device name: ring-mqtt-${stateData.systemId.slice(-5)}`)
    } catch (err) {
        console.log('Saving state file '+stateFile+' failed with error: ')
        console.log(err)
    }

    if (!fs.existsSync(configFile)) {
        try {
            const configData = {
                "mqtt_url": "mqtt://localhost:1883",
                "mqtt_options": "",
                "livestream_user": "",
                "livestream_pass": "",
                "disarm_code": "",
                "enable_cameras": true,
                "enable_modes": false,
                "enable_panic": false,
                "hass_topic": "homeassistant/status",
                "ring_topic": "ring",
                "location_ids": []
            }

            const mqttUrl = await requestInput('MQTT URL (enter to skip and edit config manually): ')
            configData.mqtt_url = mqttUrl ? mqttUrl : configData.mqtt_url

            await writeFileAtomic(configFile, JSON.stringify(configData, null, 4))
            console.log('New config file written to '+configFile)
        } catch (err) {
            console.log('Failed to create new config file at '+stateFile)
            conslog.log(err)
        }
    }
}

main()
