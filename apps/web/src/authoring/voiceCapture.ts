type AudioMediaDevices = Pick<MediaDevices, "getUserMedia">;

/**
 * Kept behind the record-button handler so merely opening or leaving the
 * optional voice step never triggers a microphone permission request.
 */
export function requestVoiceRecordingStream(
  mediaDevices: AudioMediaDevices = navigator.mediaDevices,
): Promise<MediaStream> {
  return mediaDevices.getUserMedia({ audio: true });
}
