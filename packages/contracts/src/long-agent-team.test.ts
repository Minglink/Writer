import { describe, expect, it } from "vitest";
import {
  DEFAULT_LONG_AGENT_TEAM_SETTINGS,
  LongAgentTeamSettingsSchema
} from "./index";

describe("long agent team contracts", () => {
  it("defines the single long parent team without widening WorkspaceType", () => {
    const settings = LongAgentTeamSettingsSchema.parse(
      DEFAULT_LONG_AGENT_TEAM_SETTINGS
    );
    expect(settings.workspaceType).toBe("long");
    expect(settings.teams).toHaveLength(1);
    expect(settings.teams[0]!.parentAgentId).toBe("long");
  });

  it("provides disabled writers-room subagent templates with draw, pure-bare and pure-read roles", () => {
    const members = DEFAULT_LONG_AGENT_TEAM_SETTINGS.teams[0]!.subagents;
    expect(members.map((member) => member.id)).toEqual([
      "plot_architect",
      "scene_actor",
      "chapter_writer",
      "prose_auditor",
      "continuity_recorder",
      "continuity_reviewer"
    ]);
    expect(
      members.every(
        (member) => !member.enabled && member.modelMode === "inherit"
      )
    ).toBe(true);
    const byId = new Map(members.map((member) => [member.id, member]));
    expect(byId.get("plot_architect")?.agentMode).toBe("pure-read");
    expect(byId.get("plot_architect")?.draw).toEqual({
      enabled: true,
      countMode: "auto",
      count: 3,
      selection: "auto",
      evaluator: { modelMode: "inherit" }
    });
    expect(byId.get("plot_architect")?.systemPrompt).toContain("禁止透露：");
    expect(byId.get("scene_actor")?.agentMode).toBe("pure-bare");
    expect(byId.get("chapter_writer")?.systemPrompt).toContain("tail");
    expect(byId.get("prose_auditor")?.agentMode).toBe("pure-read");
    expect(byId.get("prose_auditor")?.systemPrompt).toContain("replacements");
    expect(byId.get("continuity_recorder")?.systemPrompt).toContain(
      "documents"
    );
    expect(byId.get("continuity_recorder")?.systemPrompt).toContain("1,000");
    expect(byId.get("continuity_reviewer")?.agentMode).toBe("pure-read");
    expect(byId.get("continuity_reviewer")?.systemPrompt).toContain("search");
  });

  it("rejects team lists that do not hold exactly the long parent role", () => {
    const extra = structuredClone(DEFAULT_LONG_AGENT_TEAM_SETTINGS);
    extra.teams.push(structuredClone(extra.teams[0]!));
    expect(() => LongAgentTeamSettingsSchema.parse(extra)).toThrow();

    const empty = { ...DEFAULT_LONG_AGENT_TEAM_SETTINGS, teams: [] };
    expect(() => LongAgentTeamSettingsSchema.parse(empty)).toThrow();
  });
});
