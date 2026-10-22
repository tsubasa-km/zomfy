import { relative } from "node:path";
import { HARNESS_METHODS, type DiscoveredSkill } from "@acp-harness/protocol";
import { moveToTrash } from "../host-trash.ts";
import { discoverSkills, readSkillMarkdown } from "../skill-discovery.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerSkillHandlers({ handle, workspaces }: HandlerContext): void {
  // Read and trash accept only files a scan reported, so the client cannot name arbitrary paths.
  let known = new Map<string, DiscoveredSkill>();
  const scan = async () => {
    const projects = (await workspaces.snapshot()).projects;
    const result = await discoverSkills(projects);
    known = new Map(result.skills.map((s) => [s.skillFilePath, s]));
    return result;
  };
  const lookup = async (path: string) => {
    const skill = known.get(path) ?? (await scan(), known.get(path));
    if (!skill) throw new Error("Not a discovered skill; refresh the list");
    return skill;
  };

  handle(HARNESS_METHODS.skillsDiscover, scan);
  handle(HARNESS_METHODS.skillRead, async (p) => readSkillMarkdown((await lookup(p.skillFilePath)).skillFilePath));
  handle(HARNESS_METHODS.skillTrash, async (p) => {
    const skill = await lookup(p.skillFilePath);
    // Orca blocks these: bundled skills come back, plugin skills belong to their plugin.
    if (skill.sourceKind === "bundled" || skill.sourceKind === "plugin") {
      throw new Error(skill.sourceKind === "plugin" ? "Installed by a plugin — remove the plugin instead" : "Bundled with the agent — it would be restored");
    }
    const rel = relative(skill.rootPath, skill.directoryPath);
    if (!rel || rel.startsWith("..")) throw new Error("This skill sits at its folder's root; delete it where it is stored");
    const trashed = await moveToTrash(skill.directoryPath);
    if (trashed !== true) throw new Error(trashed);
    known.delete(skill.skillFilePath);
    return {};
  });
}
