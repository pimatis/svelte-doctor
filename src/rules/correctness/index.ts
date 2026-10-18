import type { Rule, Diagnostic, RuleContext } from "../../types.js";
import {
  buildScriptLineMap,
  buildModuleScriptLineMap,
  offsetToPosition,
} from "../../parser/lines.js";
import { isRuneCall, hasRunesInSource } from "../../parser/runes.js";
import { getLineAndColumn, ts, walkSourceFile } from "../../parser/script.js";
import { walkAst } from "../../parser/walker.js";

const MODULE_REACTIVE_MESSAGE =
  "`$:` in a module script is silently dropped by the Svelte 5 compiler";
const MODULE_REACTIVE_HELP =
  'Move this logic to the instance script as `$derived()`/`$effect()`, or compute it eagerly as a module-level `const` — reactive statements are not supported in `<script context="module">` and cannot be autofixed here';

const noLegacyReactive: Rule = {
  name: "no-legacy-reactive",
  category: "Correctness",
  severity: "error",
  message: "Legacy `$:` reactive statement detected in a Svelte 5 project",
  help: "Replace `$:` blocks with `$derived()` for computed values or `$effect()` for side effects",
  autofixable: true,
  docs: {
    summary: "Flags legacy reactive labels in runes mode.",
    whyItMatters: "Legacy reactive statements obscure intent and break Svelte 5 migration goals.",
    safeFix:
      "Map pure assignments to $derived() and side effects to $effect(). `$:` inside module scripts is reported as non-fixable because runes are invalid there.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const moduleMap = buildModuleScriptLineMap(ctx.source);
    const pattern = /^\s*\$:\s/;

    for (let i = 0; i < lines.length; i++) {
      // $: is only meaningful inside a script block — skip template and style lines
      if (!scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      const inModuleScript = moduleMap[i];
      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacyReactive.name,
        severity: noLegacyReactive.severity,
        message: inModuleScript ? MODULE_REACTIVE_MESSAGE : noLegacyReactive.message,
        help: inModuleScript ? MODULE_REACTIVE_HELP : noLegacyReactive.help,
        // module-script diagnostics have no autofix: the codemod only
        // rewrites the instance script, where runes are valid
        fixable: inModuleScript ? false : undefined,
        line: i + 1,
        column: match.index + 1,
        category: noLegacyReactive.category,
      });
    }

    return diagnostics;
  },
};

const noLegacyLifecycle: Rule = {
  name: "no-legacy-lifecycle",
  category: "Correctness",
  severity: "error",
  message: "Legacy lifecycle import detected in a Svelte 5 project",
  help: "Replace `onMount`, `onDestroy`, `beforeUpdate`, and `afterUpdate` with `$effect()`",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    // matches any of the four lifecycle functions in an import from "svelte"
    const pattern =
      /import\s+\{[^}]*(onMount|onDestroy|beforeUpdate|afterUpdate)[^}]*\}\s+from\s+['"]svelte['"]/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      // import type carries no runtime behavior
      if (/import\s+type[\s{]/.test(lines[i])) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacyLifecycle.name,
        severity: noLegacyLifecycle.severity,
        message: noLegacyLifecycle.message,
        help: noLegacyLifecycle.help,
        line: i + 1,
        column: match.index + 1,
        category: noLegacyLifecycle.category,
      });
    }

    return diagnostics;
  },
};

const noExportLet: Rule = {
  name: "no-export-let",
  category: "Correctness",
  severity: "error",
  message: "Legacy `export let` prop declaration detected in a Svelte 5 project",
  help: "Use `let { prop1, prop2 } = $props()` instead of `export let`",
  autofixable: true,
  docs: {
    summary: "Flags legacy prop declarations in runes mode.",
    whyItMatters: "Svelte 5 uses $props() destructuring instead of export let.",
    safeFix: "Replace export let declarations with a single $props() destructure.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    const pattern = /^\s*export\s+let\s+\w/;

    for (let i = 0; i < lines.length; i++) {
      if (!scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noExportLet.name,
        severity: noExportLet.severity,
        message: noExportLet.message,
        help: noExportLet.help,
        line: i + 1,
        column: match.index + 1,
        category: noExportLet.category,
      });
    }

    return diagnostics;
  },
};

const noEventDispatcher: Rule = {
  name: "no-event-dispatcher",
  category: "Correctness",
  severity: "error",
  message: "`createEventDispatcher` is deprecated in Svelte 5",
  help: "Use callback props instead by passing functions via `$props()` and calling them directly.",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const pattern = /createEventDispatcher/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
      if (/import\s+type[\s{]/.test(lines[i])) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noEventDispatcher.name,
        severity: noEventDispatcher.severity,
        message: noEventDispatcher.message,
        help: noEventDispatcher.help,
        line: i + 1,
        column: match.index + 1,
        category: noEventDispatcher.category,
      });
    }

    return diagnostics;
  },
};

const noLegacySlots: Rule = {
  name: "no-legacy-slots",
  category: "Correctness",
  severity: "error",
  message: "Legacy `<slot>` element detected in a Svelte 5 project",
  help: "Use `{@render children()}` or `{@render slotName()}` instead of `<slot>`",
  autofixable: true,
  docs: {
    summary: "Flags legacy slot elements in Svelte 5 mode.",
    whyItMatters: "Slots were replaced by snippets and render tags in the Svelte 5 API.",
    safeFix: "Rewrite slot tags to render children() or named snippet calls.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    // <slot>, <slot name="...">, <slot /> — must be an HTML element, not an attribute value
    const pattern = /<slot(?:\s|\/?>)/;

    for (let i = 0; i < lines.length; i++) {
      // slot elements only appear in template markup, not inside script blocks
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLegacySlots.name,
        severity: noLegacySlots.severity,
        message: noLegacySlots.message,
        help: noLegacySlots.help,
        line: i + 1,
        column: match.index + 1,
        category: noLegacySlots.category,
      });
    }

    return diagnostics;
  },
};

const noLetDirective: Rule = {
  name: "no-let-directive",
  category: "Correctness",
  severity: "error",
  message: "Legacy `let:` directive detected in a Svelte 5 project",
  help: "The `let:` directive is removed in Svelte 5 so use snippet props with `{@render}` blocks instead.",
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);
    // let:varName — only valid in template markup attributes
    const pattern = /\slet:\w+/;

    for (let i = 0; i < lines.length; i++) {
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noLetDirective.name,
        severity: noLetDirective.severity,
        message: noLetDirective.message,
        help: noLetDirective.help,
        line: i + 1,
        column: match.index + 1,
        category: noLetDirective.category,
      });
    }

    return diagnostics;
  },
};

const noOnDirective: Rule = {
  name: "no-on-directive",
  category: "Correctness",
  severity: "warning",
  message: "Legacy `on:` event directive detected in a Svelte 5 project",
  help: "Use `onclick`, `onchange`, etc. instead of `on:click`, `on:change`",
  autofixable: true,
  docs: {
    summary: "Flags legacy on:event directives.",
    whyItMatters:
      "Svelte 5 encourages DOM-style event attributes and drops legacy directive syntax.",
    safeFix: "Rewrite on:event to onevent when there are no modifiers.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const scriptMap = buildScriptLineMap(ctx.source);

    // on:eventname is only a valid directive in template markup
    // word boundary before "on" prevents matching "action:", "icon:", etc.
    // the colon must be immediately followed by a word character (event name)
    const pattern = /\bon:\w+/;

    for (let i = 0; i < lines.length; i++) {
      // on: directives live in the template, never in script blocks
      if (scriptMap[i]) continue;

      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noOnDirective.name,
        severity: noOnDirective.severity,
        message: noOnDirective.message,
        help: noOnDirective.help,
        line: i + 1,
        column: match.index + 1,
        category: noOnDirective.category,
      });
    }

    return diagnostics;
  },
};

const noInspectInProduction: Rule = {
  name: "no-$inspect-in-production",
  category: "Correctness",
  severity: "error",
  message: "`$inspect()` debug rune found — it becomes a noop in production but ships dead code",
  help: "Remove `$inspect()` calls before deploying. They are development-only debugging utilities.",
  docs: {
    summary: "Flags $inspect() debugging rune that should not reach production.",
    whyItMatters:
      "$inspect() ships as dead code in production builds, unnecessarily increasing bundle size.",
    safeFix: "Delete the $inspect() call or wrap it in an if (import.meta.env.DEV) guard block.",
  },
  check: (ctx) => {
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".svelte.js") &&
      !ctx.filePath.endsWith(".svelte.ts")
    )
      return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");
    const pattern = /\$inspect\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = pattern.exec(lines[i]);
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noInspectInProduction.name,
        severity: noInspectInProduction.severity,
        message: noInspectInProduction.message,
        help: noInspectInProduction.help,
        line: i + 1,
        column: match.index + 1,
        category: noInspectInProduction.category,
      });
    }

    return diagnostics;
  },
};

const noStateFrozenMisuse: Rule = {
  name: "no-$state-frozen-misuse",
  category: "Correctness",
  severity: "warning",
  message:
    "`$state.frozen()` object is mutated via destructive method — frozen state is shallow-immutable",
  help: "Replace the frozen state value wholesale instead of mutating it, e.g. `items = [...items, newItem]` instead of `items.push(newItem)`.",
  docs: {
    summary: "Flags mutations on $state.frozen() values.",
    whyItMatters:
      "$state.frozen() creates shallow-immutable state. Mutating methods like .push() or .splice() silently fail to trigger updates.",
    safeFix: "Reassign the value with a new copy: items = [...items, newItem].",
  },
  check: (ctx) => {
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".svelte.js") &&
      !ctx.filePath.endsWith(".svelte.ts")
    )
      return [];
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const frozenMatch = lines[i].match(/(?:const|let|var)\s+(\w+)\s*=\s*\$state\.frozen\s*\(/);
      if (!frozenMatch) continue;

      const varName = frozenMatch[1];

      for (let j = i; j < lines.length; j++) {
        const laterTrimmed = lines[j].trimStart();
        if (laterTrimmed.startsWith("//") || laterTrimmed.startsWith("*")) continue;

        if (
          new RegExp(
            `\\b${varName}\\s*\\.\\s*(?:push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin)\\s*\\(`,
          ).test(laterTrimmed)
        ) {
          diagnostics.push({
            filePath: ctx.filePath,
            rule: noStateFrozenMisuse.name,
            severity: noStateFrozenMisuse.severity,
            message: `${noStateFrozenMisuse.message} (mutating \`${varName}\`)`,
            help: noStateFrozenMisuse.help,
            line: j + 1,
            column: laterTrimmed.indexOf(varName) + 1,
            category: noStateFrozenMisuse.category,
          });
        }
      }
    }

    return diagnostics;
  },
};

const noClassInstanceAsState: Rule = {
  name: "no-class-instance-as-$state",
  category: "Correctness",
  severity: "warning",
  message:
    "Class instance passed to `$state()` — property access on class instances does not create reactive dependencies",
  help: "Use individual reactive primitives ($state) for each field instead of wrapping the whole class instance.",
  docs: {
    summary: "Flags class instances wrapped in $state().",
    whyItMatters:
      "Svelte 5 fine-grained reactivity tracks primitive value access, not class property access. Instance property reads inside $derived or template won't register as dependencies.",
    safeFix:
      "Store individual reactive fields: let name = $state(instance.name) instead of let obj = $state(new MyClass()).",
  },
  check: (ctx) => {
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".svelte.js") &&
      !ctx.filePath.endsWith(".svelte.ts")
    )
      return [];
    if (!ctx.projectInfo.usesRunes) return [];

    const diagnostics: Diagnostic[] = [];
    const lines = ctx.source.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trimStart();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;

      const match = lines[i].match(
        /(?:let|const|var)\s+\w+\s*=\s*\$state\s*(?:<[^>]*>)?\s*\(\s*new\s+\w+/,
      );
      if (!match) continue;

      diagnostics.push({
        filePath: ctx.filePath,
        rule: noClassInstanceAsState.name,
        severity: noClassInstanceAsState.severity,
        message: noClassInstanceAsState.message,
        help: noClassInstanceAsState.help,
        line: i + 1,
        column: match.index! + 1,
        category: noClassInstanceAsState.category,
      });
    }

    return diagnostics;
  },
};

const ASSIGNMENT_OPERATORS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

interface PropBinding {
  name: string;
  line: number;
  column: number;
  bindable: boolean;
}

// collects prop names declared through `let { ... } = $props()` (and the props
// object binding) so writes and bind: directives can be matched against them
const collectPropBindings = (
  ctx: RuleContext,
): { props: Map<string, PropBinding>; propsObjects: Set<string> } => {
  const props = new Map<string, PropBinding>();
  const propsObjects = new Set<string>();

  for (const block of ctx.scriptBlocks) {
    if (block.kind === "module") continue;

    walkSourceFile(block.sourceFile, (node) => {
      if (!ts.isVariableStatement(node)) return;

      for (const declaration of node.declarationList.declarations) {
        const initializer = declaration.initializer;
        if (!initializer || !ts.isCallExpression(initializer)) continue;
        if (!isRuneCall(initializer, "$props")) continue;

        if (ts.isIdentifier(declaration.name)) {
          propsObjects.add(declaration.name.text);
          continue;
        }

        if (!ts.isObjectBindingPattern(declaration.name)) continue;

        for (const element of declaration.name.elements) {
          if (!ts.isIdentifier(element.name)) continue;
          const position = getLineAndColumn(block, element.name.getStart(block.sourceFile));
          const bindable =
            !!element.initializer &&
            ts.isCallExpression(element.initializer) &&
            isRuneCall(element.initializer, "$bindable");
          props.set(element.name.text, { name: element.name.text, ...position, bindable });
        }
      }
    });
  }

  return { props, propsObjects };
};

const rootIdentifier = (node: ts.Expression): ts.Identifier | null => {
  let current: ts.Expression = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current : null;
};

const MUTATING_METHODS = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "delete",
  "clear",
  "add",
]);

// reassigning or mutating a prop breaks one-way data flow: the parent owns the
// value, and Svelte 5 rejects reassignment of a non-bindable prop outright
const propMutation: Rule = {
  name: "prop-mutation",
  category: "Correctness",
  severity: "error",
  message: "Prop is reassigned or mutated inside the component that receives it",
  help: "Props are read-only in Svelte 5. Declare the prop with `$bindable()` to allow two-way binding, or emit a callback prop (`onchange`) and let the parent update its own state.",
  docs: {
    summary: "Flags writes to $props() bindings.",
    whyItMatters:
      "Reassigning a prop is a Svelte 5 compile error, and mutating a prop's properties hides the owner and breaks one-way data flow.",
    safeFix:
      "Lift the write to the parent: pass a callback prop, or mark the prop with $bindable() when the parent really wants two-way binding.",
  },
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (
      !ctx.filePath.endsWith(".svelte") &&
      !ctx.filePath.endsWith(".svelte.js") &&
      !ctx.filePath.endsWith(".svelte.ts")
    ) {
      return [];
    }
    if (!hasRunesInSource(ctx.source)) return [];

    const { props, propsObjects } = collectPropBindings(ctx);
    if (props.size === 0 && propsObjects.size === 0) return [];

    const diagnostics: Diagnostic[] = [];
    const reported = new Set<string>();

    const push = (diagnostic: Diagnostic, key: string) => {
      if (reported.has(key)) return;
      reported.add(key);
      diagnostics.push(diagnostic);
    };

    for (const block of ctx.scriptBlocks) {
      if (block.kind === "module") continue;

      walkSourceFile(block.sourceFile, (node) => {
        if (
          (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
          ts.isIdentifier(node.operand)
        ) {
          const binding = props.get(node.operand.text);
          // a $bindable() prop is owned by the parent and may be reassigned
          if (!binding || binding.bindable) return;
          const position = getLineAndColumn(block, node.getStart(block.sourceFile));
          push(
            {
              filePath: ctx.filePath,
              rule: propMutation.name,
              severity: propMutation.severity,
              message: `\`${binding.name}\` is reassigned here — props are read-only`,
              help: propMutation.help,
              line: position.line,
              column: position.column,
              category: propMutation.category,
            },
            `${position.line}:${position.column}`,
          );
          return;
        }

        if (!ts.isBinaryExpression(node) || !ASSIGNMENT_OPERATORS.has(node.operatorToken.kind)) {
          // in-place mutation through a mutating method: items.push(...)
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.text;
            if (!MUTATING_METHODS.has(method)) return;
            const root = rootIdentifier(node.expression.expression);
            if (!root) return;
            const binding = props.get(root.text);
            if (!binding) return;

            const position = getLineAndColumn(block, node.getStart(block.sourceFile));
            push(
              {
                filePath: ctx.filePath,
                rule: propMutation.name,
                severity: "warning",
                message: `\`${binding.name}.${method}()\` mutates a prop in place`,
                help: propMutation.help,
                line: position.line,
                column: position.column,
                category: propMutation.category,
              },
              `${position.line}:${position.column}:${method}`,
            );
          }
          return;
        }

        if (ts.isIdentifier(node.left)) {
          const binding = props.get(node.left.text);
          // a $bindable() prop is owned by the parent and may be reassigned
          if (!binding || binding.bindable) return;
          const position = getLineAndColumn(block, node.getStart(block.sourceFile));
          push(
            {
              filePath: ctx.filePath,
              rule: propMutation.name,
              severity: propMutation.severity,
              message: `\`${binding.name}\` is reassigned here — props are read-only`,
              help: propMutation.help,
              line: position.line,
              column: position.column,
              category: propMutation.category,
            },
            `${position.line}:${position.column}`,
          );
          return;
        }

        if (!ts.isPropertyAccessExpression(node.left) && !ts.isElementAccessExpression(node.left)) {
          return;
        }

        const root = rootIdentifier(node.left);
        if (!root) return;
        const isPropValue = props.has(root.text);
        const isPropsObject = propsObjects.has(root.text);
        if (!isPropValue && !isPropsObject) return;

        const position = getLineAndColumn(block, node.getStart(block.sourceFile));
        push(
          {
            filePath: ctx.filePath,
            rule: propMutation.name,
            severity: "warning",
            message: `Property of \`${root.text}\` is mutated — props should not be modified in place`,
            help: propMutation.help,
            line: position.line,
            column: position.column,
            category: propMutation.category,
          },
          `${position.line}:${position.column}`,
        );
      });
    }

    return diagnostics;
  },
};

// `bind:` on a plain prop throws at runtime; only $bindable() props accept bindings
const propNotBindable: Rule = {
  name: "prop-not-bindable",
  category: "Correctness",
  severity: "error",
  message: "`bind:` is used on a prop that is not declared with `$bindable()`",
  help: "Declare the prop as bindable: `let { value = $bindable() } = $props()`. Svelte 5 only allows binding to props that opted in.",
  docs: {
    summary: "Flags bind: directives targeting non-bindable props.",
    whyItMatters:
      'Binding to a non-bindable prop fails at runtime with "Cannot bind to a non-bindable property".',
    safeFix: "Add `= $bindable()` to the prop's destructuring default.",
  },
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.projectInfo.usesRunes) return [];
    if (!ctx.filePath.endsWith(".svelte")) return [];
    if (!ctx.ast) return [];
    if (!hasRunesInSource(ctx.source)) return [];

    const { props } = collectPropBindings(ctx);
    if (props.size === 0) return [];

    const diagnostics: Diagnostic[] = [];

    walkAst(ctx.ast, (node) => {
      if (!node || node.type !== "BindDirective") return;
      const expression = node.expression;
      if (!expression || expression.type !== "Identifier") return;

      const binding = props.get(expression.name);
      if (!binding || binding.bindable) return;

      const { line, column } = offsetToPosition(ctx.source, node.start ?? 0);
      diagnostics.push({
        filePath: ctx.filePath,
        rule: propNotBindable.name,
        severity: propNotBindable.severity,
        message: `\`bind:\` targets prop \`${binding.name}\` which is not bindable`,
        help: `Declare it as \`let { ${binding.name} = $bindable() } = $props()\` or bind to a local \`$state\` instead.`,
        line,
        column,
        category: propNotBindable.category,
      });
    });

    return diagnostics;
  },
};

export const correctnessRules: Rule[] = [
  noLegacyReactive,
  noLegacyLifecycle,
  noExportLet,
  noEventDispatcher,
  noLegacySlots,
  noLetDirective,
  noOnDirective,
  noInspectInProduction,
  noStateFrozenMisuse,
  noClassInstanceAsState,
  propMutation,
  propNotBindable,
];
