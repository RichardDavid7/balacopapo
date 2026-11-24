package com.backspace.core.voice

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import com.backspace.core.model.AudioOutputRoute

/**
 * Roteador nativo de áudio Android (estilo Mumble/Mumla) em MODE_IN_COMMUNICATION.
 */
class VoiceAudioRouter(context: Context) {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    fun enterVoiceMode() {
        audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
    }

    fun exitVoiceMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audioManager.stopBluetoothSco()
            @Suppress("DEPRECATION")
            audioManager.isBluetoothScoOn = false
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    fun setOutputRoute(route: AudioOutputRoute) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = audioManager.availableCommunicationDevices
            val target = when (route) {
                AudioOutputRoute.BLUETOOTH -> devices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO
                }
                AudioOutputRoute.WIRED_HEADSET -> devices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
                        it.type == AudioDeviceInfo.TYPE_USB_HEADSET
                }
                AudioOutputRoute.SPEAKER -> devices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
                }
                AudioOutputRoute.EARPIECE -> devices.firstOrNull {
                    it.type == AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
                }
            }
            if (target != null) {
                audioManager.setCommunicationDevice(target)
            }
        } else {
            @Suppress("DEPRECATION")
            when (route) {
                AudioOutputRoute.BLUETOOTH -> {
                    audioManager.isSpeakerphoneOn = false
                    audioManager.startBluetoothSco()
                    audioManager.isBluetoothScoOn = true
                }
                AudioOutputRoute.SPEAKER -> {
                    audioManager.stopBluetoothSco()
                    audioManager.isBluetoothScoOn = false
                    audioManager.isSpeakerphoneOn = true
                }
                AudioOutputRoute.WIRED_HEADSET, AudioOutputRoute.EARPIECE -> {
                    audioManager.stopBluetoothSco()
                    audioManager.isBluetoothScoOn = false
                    audioManager.isSpeakerphoneOn = false
                }
            }
        }
    }

    fun detectPreferredRoute(): AudioOutputRoute {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val devices = audioManager.availableCommunicationDevices
            return when {
                devices.any { it.type == AudioDeviceInfo.TYPE_BLE_HEADSET || it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO } ->
                    AudioOutputRoute.BLUETOOTH
                devices.any { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_HEADSET } ->
                    AudioOutputRoute.WIRED_HEADSET
                else -> AudioOutputRoute.SPEAKER
            }
        }
        return AudioOutputRoute.SPEAKER
    }
}
