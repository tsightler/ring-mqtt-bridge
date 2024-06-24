import { parentPort, workerData } from 'worker_threads'
import { WebrtcConnection } from '../lib/streaming/webrtc-connection.js'
import { StreamingSession } from '../lib/streaming/streaming-session.js'

const deviceName = workerData.deviceName
const doorbotId = workerData.doorbotId
let liveStream = false

parentPort.on("message", async(data) => {
    const streamData = data.streamData
    switch (data.command) {
        case 'start':
            if (!liveStream) {
                startLiveStream(streamData)
            }
            break;
        case 'stop':
            if (liveStream) {
                stopLiveStream()
            }
            break;
    }
})

async function startLiveStream(streamData) {
    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC worker received start command'})
    try {
        const cameraData = {
            name: deviceName,
            id: doorbotId
        }

        const streamConnection = new WebrtcConnection(streamData.ticket, cameraData)
        liveStream = new StreamingSession(cameraData, streamConnection)

        liveStream.connection.pc.onConnectionState.subscribe(async (data) => {
            switch(data) {
                case 'connected':
                    parentPort.postMessage({type: 'state', data: 'active'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session is connected'})
                    break;
                case 'failed':
                    parentPort.postMessage({type: 'state', data: 'failed'})
                    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC connection has failed'})
                    liveStream.stop()
                    await new Promise(res => setTimeout(res, 2000))
                    liveStream = false
                    break;
            }
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process is starting'})
        await liveStream.startTranscoding({
            // The native AVC video stream is copied to the RTSP server unmodified while the audio
            // stream is converted into two output streams using both AAC and Opus codecs.  This
            // provides a stream with wide compatibility across various media player technologies.
            audio: [
                '-map', '0:v',
                '-map', '0:a',
                '-map', '0:a',
                '-c:a:0', 'aac',
                '-c:a:1', 'copy',
            ],
            video: [
                '-c:v', 'copy'
            ],
            output: [
                '-flags', '+global_header',
                '-f', 'rtsp',
                '-rtsp_transport', 'tcp',
                streamData.rtspPublishUrl
            ]
        })

        parentPort.postMessage({type: 'log_info', data: 'Live stream transcoding process has started'})

        liveStream.onCallEnded.subscribe(() => {
            parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC session has disconnected'})
            parentPort.postMessage({type: 'state', data: 'inactive'})
            liveStream = false
        })
    } catch(error) {
        parentPort.postMessage({type: 'log_error', data: error})
        parentPort.postMessage({type: 'state', data: 'failed'})
        liveStream = false
    }
}

async function stopLiveStream() {
    parentPort.postMessage({type: 'log_info', data: 'Live stream WebRTC worker received stop command'})
    liveStream.stop()
    await new Promise(res => setTimeout(res, 2000))
    if (liveStream) {
        parentPort.postMessage({type: 'log_info', data: 'Live stream failed to stop on request, deleting anyway...'})
        parentPort.postMessage({type: 'state', data: 'inactive'})
        liveStream = false
    }
}