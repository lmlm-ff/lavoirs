import type { MatchGroup, GroupMember } from '../../../../../packages/shared/src/matching';
import { LiveKitRoom } from './LiveKitRoom';

export default function RoomPage({ group, user, onLeave }: { group: MatchGroup; user: GroupMember; onLeave: () => void }) {
  return <section className="page-content">
    <div className="eyebrow">YOUR ROOM · {group.matchType === 'nearby' ? 'NEARBY MATCH' : 'SHARED INTEREST MATCH'}</div>
    <h1>You’ve found <em>your group.</em></h1>
    <p className="muted">Your conversation starts with a shared interest. Join when you’re ready.</p>
    <LiveKitRoom groupId={group.id} user={user} onLeave={onLeave}/>
    <div className="surface room-prompt"><div className="eyebrow">A LITTLE ICEBREAKER</div><h2>{group.icebreakerPrompt || 'Your group’s icebreaker is being prepared…'}</h2>{group.sharedInterests?.length ? <p className="field-hint">A shared spark: {group.sharedInterests.join(' · ')}</p> : null}</div>
    <button className="primary" onClick={onLeave}>Back to the queue</button>
  </section>;
}
