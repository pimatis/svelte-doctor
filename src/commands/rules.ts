import { Command } from "commander";
import { allRules } from "../rules/index.js";
import { printRules } from "../output/rules.js";

export const rulesCommand = new Command("rules")
  .description("List available diagnostics rules")
  .action(() => { printRules(allRules); });
