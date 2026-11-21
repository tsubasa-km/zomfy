import { cp, mkdir, stat } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import { HARNESS_METHODS, type DiscoveredSkill, type SkillCopyOutcome, type SkillDiscoverySource } from "@zomfy/protocol";
import { moveToTrash } from "../host-trash.ts";
import { discoverSkills, readSkillMarkdown } from "../skill-discovery.ts";
import type { HandlerContext } from "./handler-context.ts";

export function registerSkillHandlers({ handle, workspaces }: HandlerContext): void {
  // Read and trash accept only files a scan reported, so the client cannot name arbitrary paths.
  let known = new Map<string, DiscoveredSkill>();
  let sources = new Map<string, SkillDiscoverySource>();
  const scan = async () => {
    const projects = (await workspaces.snapshot()).projects;
    const result = await discoverSkills(projects);
    known = new Map(result.skills.map((s) => [s.skillFilePath, s]));
    sources = new Map(result.sources.map((s) => [s.id, s]));
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

  // Orca's one-click install, from a skill already on this host: its folder is copied as it is
  // into each chosen agent's own skill folder (a home or a project's), never over one there.
  handle(HARNESS_METHODS.skillCopy, async (p) => {
    const skill = await lookup(p.skillFilePath);
    const rel = relative(skill.rootPath, skill.directoryPath);
    if (!rel || rel.startsWith("..")) throw new Error("This skill sits at its folder's root, so it has no folder of its own to copy");
    const name = basename(skill.directoryPath);
    const outcomes: SkillCopyOutcome[] = [];
    for (const sourceId of p.sourceIds) {
      const source = sources.get(sourceId);
      if (!source || (source.sourceKind !== "home" && source.sourceKind !== "repo")) {
        outcomes.push({ sourceId, status: "failed", error: "Not a skill folder Zomfy can add to" });
        continue;
      }
      const target = join(source.path, name);
      if (await stat(target).then(() => true, () => false)) {
        outcomes.push({ sourceId, status: "exists" });
        continue;
      }
      try {
        await mkdir(source.path, { recursive: true });
        await cp(skill.directoryPath, target, { recursive: true, errorOnExist: true, force: false });
        outcomes.push({ sourceId, status: "copied" });
      } catch (error) {
        outcomes.push({ sourceId, status: "failed", error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { outcomes };
  });
}
