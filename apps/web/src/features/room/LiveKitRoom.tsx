import { useCallback, useEffect, useRef, useState } from 'react';
import {
    LocalParticipant,
    Participant,
    Room as LiveKitClientRoom,
    RoomEvent,
    Track,
} from 'livekit-client';
import type { GroupMember } from '../../../../../packages/shared/src/matching.js';
import { requestRoomToken } from '../../lib/livekit-client.js';

interface Props {
    groupId: string;
    user: GroupMember;
    onLeave: () => void;
}

export function LiveKitRoom({ groupId, user, onLeave }: Props) {
    const [room, setRoom] = useState<LiveKitClientRoom | null>(null);
    const [participants, setParticipants] = useState<Participant[]>([]);
    const [connecting, setConnecting] = useState(false);
    const [message, setMessage] = useState('Not connected yet. Join to enter the matched group.');
    const [error, setError] = useState('');
    const [micOn, setMicOn] = useState(false);
    const [cameraOn, setCameraOn] = useState(false);
    const roomRef = useRef<LiveKitClientRoom | null>(null);
    const attempt = useRef(0);

    const refreshParticipants = useCallback((activeRoom: LiveKitClientRoom) => {
        setParticipants([activeRoom.localParticipant, ...activeRoom.remoteParticipants.values()]);
    }, []);

    useEffect(() => () => {
        attempt.current++;
        roomRef.current?.disconnect();
        roomRef.current = null;
    }, []);

    async function join() {
        const currentAttempt = ++attempt.current;
        setConnecting(true);
        setError('');
        setMessage('Checking group access and requesting a room token…');
        let clientRoom: LiveKitClientRoom | null = null;

        try {
            const payload = await requestRoomToken(groupId);
            if (currentAttempt !== attempt.current) return;

            clientRoom = new LiveKitClientRoom({ adaptiveStream: false, dynacast: true });
            roomRef.current = clientRoom;
            const refresh = () => refreshParticipants(clientRoom!);
            clientRoom
                .on(RoomEvent.ParticipantConnected, refresh)
                .on(RoomEvent.ParticipantDisconnected, refresh)
                .on(RoomEvent.TrackSubscribed, refresh)
                .on(RoomEvent.TrackUnsubscribed, refresh)
                .on(RoomEvent.LocalTrackPublished, refresh)
                .on(RoomEvent.LocalTrackUnpublished, refresh)
                .on(RoomEvent.TrackMuted, refresh)
                .on(RoomEvent.TrackUnmuted, refresh)
                .on(RoomEvent.Disconnected, () => {
                    setRoom(null);
                    setParticipants([]);
                    setMicOn(false);
                    setCameraOn(false);
                    roomRef.current = null;
                });

            await clientRoom.connect(payload.serverUrl, payload.participantToken);
            if (currentAttempt !== attempt.current) { await clientRoom.disconnect(); return; }
            setRoom(clientRoom);
            refreshParticipants(clientRoom);
            setMessage(`Connected as ${payload.participantName} · ${payload.roomName}`);

            // Permission denial does not strand the member in the room. They can
            // remain connected and retry either device with the controls below.
            try {
                await clientRoom.localParticipant.setMicrophoneEnabled(true);
                setMicOn(true);
            } catch (deviceError) {
                setMessage('Joined.');
                setError(describeMediaError('Microphone', deviceError));
            }
            if (currentAttempt !== attempt.current) { await clientRoom.disconnect(); return; }
            try {
                await clientRoom.localParticipant.setCameraEnabled(true);
                setCameraOn(true);
            } catch (deviceError) {
                setMessage('Joined.');
                setError(describeMediaError('Camera', deviceError));
            }
            if (currentAttempt !== attempt.current) { await clientRoom.disconnect(); return; }
            refreshParticipants(clientRoom);
        } catch (joinError) {
            clientRoom?.disconnect();
            roomRef.current = null;
            setRoom(null);
            setParticipants([]);
            setMessage('Could not join the room.');
            setError(joinError instanceof Error ? joinError.message : 'Unexpected connection error.');
        } finally {
            setConnecting(false);
        }
    }

    async function leave() {
        attempt.current++;
        const activeRoom = roomRef.current;
        if (!activeRoom) return;
        setMessage('Leaving room…');
        await activeRoom.disconnect();
        roomRef.current = null;
        setRoom(null);
        setParticipants([]);
        setMicOn(false);
        setCameraOn(false);
        setMessage('You left the room. Rejoin whenever you are ready.');
        onLeave();
    }

    async function toggleMicrophone() {
        if (!room) return;
        try {
            await room.localParticipant.setMicrophoneEnabled(!micOn);
            setMicOn(!micOn);
            setError('');
        } catch (deviceError) {
            setError(describeMediaError('Microphone', deviceError));
        }
    }

    async function toggleCamera() {
        if (!room) return;
        try {
            await room.localParticipant.setCameraEnabled(!cameraOn);
            setCameraOn(!cameraOn);
            refreshParticipants(room);
            setError('');
        } catch (deviceError) {
            setError(describeMediaError('Camera', deviceError));
        }
    }

    return (
        <section className="call-card surface">
            <div className="call-heading">
                <div><span className="eyebrow">YOUR CONVERSATION</span><h2>Meet in the room</h2></div>
                <span className={`connection-pill ${room ? 'is-live' : ''}`}><i />{room ? 'CONNECTED' : connecting ? 'CONNECTING' : 'READY'}</span>
            </div>
            <p className="room-status" role="status">{message}</p>
            {error ? <div className="error-banner" role="alert">{error}</div> : null}

            {room ? (
                <>
                    <div className="video-grid" aria-label="Room participants">
                        {participants.map((participant) => <ParticipantTile key={participant.identity} participant={participant} local={participant instanceof LocalParticipant} />)}
                        {participants.length < 4 ? <div className="waiting-tile"><span>✳</span><p>Waiting for more people to join…</p></div> : null}
                    </div>
                    <div className="call-controls">
                        <button className={`control-button ${micOn ? 'enabled' : ''}`} onClick={() => void toggleMicrophone()}><span>{micOn ? '🎙' : '🔇'}</span>{micOn ? 'Mute mic' : 'Turn mic on'}</button>
                        <button className={`control-button ${cameraOn ? 'enabled' : ''}`} onClick={() => void toggleCamera()}><span>{cameraOn ? '▣' : '□'}</span>{cameraOn ? 'Turn camera off' : 'Turn camera on'}</button>
                        <button className="leave-button" onClick={() => void leave()}><span>↗</span> Leave room</button>
                    </div>
                </>
            ) : (
                <div className="empty-call">
                    <div className="call-illustration"><span>✳</span><i /><i /><i /><i /></div>
                    <h3>Ready when you are.</h3>
                    <p>Join as {user.name}. Your browser will ask for mic and camera access.</p>
                    <button className="primary" onClick={() => void join()} disabled={connecting}>{connecting ? 'Connecting…' : 'Join group room'}<span>→</span></button>
                </div>
            )}
            <div className="room-footnote">Room ID <code>{groupId}</code> · token limited to this room · leave disconnects your client</div>
        </section>
    );
}

function describeMediaError(device: 'Camera' | 'Microphone', error: unknown): string {
    const name = error instanceof Error ? error.name : '';
    if (name === 'NotReadableError' || name === 'AbortError') {
        return `${device} is unavailable or may be busy in another tab/app. Try another device or close the other camera client.`;
    }
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return `${device} permission was denied. Allow it in the browser's site settings, then retry.`;
    }
    if (name === 'NotFoundError') {
        return `No ${device.toLowerCase()} was found. Connect one or join with that device off.`;
    }
    return `${device} could not start${name ? ` (${name})` : ''}. Check browser permissions and device availability.`;
}

function ParticipantTile({ participant, local }: { participant: Participant; local: boolean }) {
    const cameraTrack = participant.getTrackPublication(Track.Source.Camera)?.track;
    const microphoneTrack = participant.getTrackPublication(Track.Source.Microphone)?.track;
    const videoRef = useCallback((element: HTMLVideoElement | null) => {
        if (!element || !cameraTrack) return;
        cameraTrack.attach(element);
        return () => { cameraTrack.detach(element); };
    }, [cameraTrack]);
    const audioRef = useCallback((element: HTMLAudioElement | null) => {
        if (!element || local || !microphoneTrack) return;
        microphoneTrack.attach(element);
        return () => { microphoneTrack.detach(element); };
    }, [local, microphoneTrack]);

    return (
        <article className={`video-tile ${local ? 'local-tile' : ''}`}>
            {cameraTrack ? <video ref={videoRef} autoPlay playsInline muted /> : <div className="camera-placeholder"><span>{participant.name?.slice(0, 1) ?? participant.identity.slice(0, 1).toUpperCase()}</span></div>}
            {!local && microphoneTrack ? <audio ref={audioRef} autoPlay /> : null}
            <div className="video-label"><span>{participant.name || participant.identity}{local ? ' · You' : ''}</span><i className={local ? 'local-dot' : ''} /></div>
        </article>
    );
}
