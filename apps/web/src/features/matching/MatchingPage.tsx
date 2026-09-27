import { useEffect, useRef, useState } from 'react';
import { ArrowRight, MapPin, Users, Clock, Sparkles } from 'lucide-react';
import type { Profile } from '../../../../../packages/shared/src/profile';
import type { MatchGroup, QueueState } from '../../../../../packages/shared/src/matching';
import { localRequest } from '../../lib/local-services';

const idle: QueueState = { status: 'idle' };

export default function MatchingPage({ profile, onEdit, onJoin }: { profile: Profile; onEdit: () => void; onJoin: (group: MatchGroup) => void }) {
  const [queueState, setQueueState] = useState<QueueState>(idle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsManualLocation, setNeedsManualLocation] = useState(false);
  const [manualLocation, setManualLocation] = useState({ latitude: '', longitude: '' });
  const stopPolling = useRef(false);

  useEffect(() => {
    let active = true;
    void localRequest<QueueState>('queue').then(next => {
      if (!active) return;
      if (next.status === 'matched') onJoin(next.group);
      else setQueueState(next);
    }).catch(() => {
      if (active) setError('Could not restore your queue. Check your connection and try again.');
    });
    return () => { active = false; };
  }, [onJoin]);

  useEffect(() => {
    if (queueState.status !== 'waiting') return;
    let active = true;
    const poll = async () => {
      try {
        const next = await localRequest<QueueState>('queue');
        if (!active || stopPolling.current) return;
        if (next.status === 'matched') onJoin(next.group);
        else setQueueState(next);
      } catch {
        if (active) setError('Could not refresh your queue. Check your connection and try again.');
      }
    };
    const timer = window.setInterval(() => void poll(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, [queueState.status, onJoin]);

  async function join() {
    setBusy(true);
    setError('');
    stopPolling.current = false;
    try {
      if (!navigator.geolocation) throw new Error('Location access is unavailable in this browser.');
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('Allow location access, or enter coordinates below.')), {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 12_000,
        });
      });
      await joinAtCoordinates(position.coords.latitude, position.coords.longitude);
    } catch (cause) {
      setNeedsManualLocation(true);
      setError(cause instanceof Error ? cause.message : 'Could not join the queue. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function joinManually() {
    const latitude = Number(manualLocation.latitude);
    const longitude = Number(manualLocation.longitude);
    if (!manualLocation.latitude.trim() || !manualLocation.longitude.trim()
      || !Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter a valid latitude and longitude.');
      return;
    }
    setBusy(true);
    setError('');
    stopPolling.current = false;
    try {
      await joinAtCoordinates(latitude, longitude);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join the queue. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function joinAtCoordinates(latitude: number, longitude: number) {
    const next = await localRequest<QueueState>('queue', {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude }),
    });
    setNeedsManualLocation(false);
    if (next.status === 'matched') onJoin(next.group);
    else setQueueState(next);
  }

  async function leave() {
    setBusy(true);
    setError('');
    stopPolling.current = true;
    try {
      await localRequest('queue', { method: 'DELETE' });
      setQueueState(idle);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not leave the queue. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const waiting = queueState.status === 'waiting';
  const nearbyCount = waiting ? queueState.nearbyCount : 0;
  const seatsFilled = waiting ? Math.min(queueState.groupSize, nearbyCount + 1) : 1;
  const groupSize = waiting ? queueState.groupSize : 4;

  return <section className="page-content">
    <div className="eyebrow">YOUR PEOPLE ARE OUT THERE</div>
    <h1>A good conversation<br/>starts with <em>hello.</em></h1>
    <p className="muted">Four people, shared interests, and a little room for the unexpected.</p>
    <div className="queue-layout">
      <div className="surface queue-main">
        <div className="section-top"><span className="pill"><span className="status-dot"/>{waiting ? 'Searching nearby' : 'Ready to meet'}</span><span className="muted"><MapPin size={14}/> {profile.location} · {profile.radiusKm} km</span></div>
        <h2>{waiting ? 'Finding your conversation.' : 'Meet your next conversation.'}</h2>
        <p className="muted">{waiting ? 'We’ll bring you together when four compatible people are ready.' : 'A small group. A shared spark. No crowded rooms.'}</p>
        <div className="queue-people">{Array.from({ length: groupSize }, (_, i) => <div key={i}>
          <div className={`queue-avatar ${i < seatsFilled ? `filled color-${i % 4}` : ''}`}>{i === 0 ? profile.name.slice(0, 1).toUpperCase() : i < seatsFilled ? <Users size={23}/> : <Users size={23}/>}</div>
          <strong>{i === 0 ? 'You' : i < seatsFilled ? 'Nearby' : 'Open seat'}</strong><small>{i === 0 ? waiting ? 'In the queue' : 'Ready to connect' : i < seatsFilled ? 'Compatible interests' : 'Waiting for a match'}</small>
        </div>)}</div>
        <div className="queue-message" role="status">
          {busy ? 'Updating your queue…' : waiting ? `${nearbyCount} compatible ${nearbyCount === 1 ? 'person is' : 'people are'} nearby. You can leave at any time.` : 'Your seat is waiting.'}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {waiting
          ? <button className="primary" disabled={busy} onClick={() => void leave()}>Leave the queue</button>
          : <button className="primary" disabled={busy} onClick={() => void join()}>{busy ? 'Finding nearby people…' : 'Join the queue'}<ArrowRight size={18}/></button>}
        {needsManualLocation && !waiting ? <div>
          <p className="field-hint">If location permission is denied or unavailable, enter your coordinates to continue.</p>
          <div className="form-grid">
            <label>Latitude<input type="number" min="-90" max="90" step="any" value={manualLocation.latitude} onChange={event => setManualLocation({ ...manualLocation, latitude: event.target.value })} placeholder="49.2827"/></label>
            <label>Longitude<input type="number" min="-180" max="180" step="any" value={manualLocation.longitude} onChange={event => setManualLocation({ ...manualLocation, longitude: event.target.value })} placeholder="-123.1207"/></label>
          </div>
          <button className="text-button" disabled={busy} onClick={() => void joinManually()}>Join using these coordinates</button>
        </div> : null}
        <p className="field-hint">Your exact location is used on the server to check your radius and is not shown to other members. Your browser may ask permission when you join.</p>
      </div>
      <aside className="queue-sidebar">
        <div className="surface"><div className="section-top"><h3>Your common ground</h3><button className="text-button" onClick={onEdit}>Edit</button></div><div className="interest-list">{profile.interests.map(i => <span className="interest selected" key={i}>{i}</span>)}</div><p className="field-hint">These are the interests used for this session’s matching and icebreaker.</p></div>
        <div className="surface what-next"><h3>A little of what to expect</h3><p><Users size={19}/><span><strong>Just four of you</strong>A conversation everyone has space in.</span></p><p><Sparkles size={19}/><span><strong>Skip the awkward start</strong>Your group gets an icebreaker based on its shared interests.</span></p><p><Clock size={19}/><span><strong>20 minutes to connect</strong>Then discover local things to do together.</span></p></div>
      </aside>
    </div>
  </section>;
}
