import type { User } from "../profiles/Profile.js";

export type MatchType = "shared-interest" | "nearby";

/** One created chat group and the users assigned to it. */
export class Group {
  readonly memberIds: string[];
  readonly sharedInterests: string[];
  readonly createdAt: Date;
  icebreakerPrompt: string | null = null;
  status: "active" | "ended" = "active";

  constructor(
    readonly id: string,
    readonly members: User[],
    readonly matchType: MatchType,
    createdAt = new Date(),
  ) {
    if (!id.trim()) throw new Error("Group id is required");
    if (members.length < 2) throw new Error("A group must have at least two members");
    if (new Set(members.map((member) => member.id)).size !== members.length) {
      throw new Error("A group cannot contain the same user more than once");
    }
    if (members.some((member) => member.groupId && member.groupId !== id)) {
      throw new Error("A user already belongs to another group");
    }

    this.memberIds = members.map((member) => member.id);
    this.sharedInterests = members[0].interests.filter((interest) =>
      members.every((member) => member.interests.includes(interest)),
    );
    this.createdAt = new Date(createdAt);

    // Group owns assignment: once a group is created, members leave the queue.
    for (const member of members) {
      member.groupId = id;
      member.inQueue = false;
    }
  }

  end(): void {
    this.status = "ended";
    for (const member of this.members) {
      if (member.groupId === this.id) member.groupId = null;
    }
  }

  setIcebreakerPrompt(prompt: string): void {
    this.icebreakerPrompt = prompt;
  }

  removeMember(userId: string): boolean {
    const index = this.members.findIndex((member) => member.id === userId);
    if (index < 0) return false;
    const [member] = this.members.splice(index, 1);
    this.memberIds.splice(index, 1);
    if (member.groupId === this.id) member.groupId = null;
    member.inQueue = false;
    if (this.members.length === 0) this.end();
    return true;
  }
}
