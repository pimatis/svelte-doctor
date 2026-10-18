import type { Rule, Diagnostic, RuleContext } from "../../types.js";
import {
  type AstNode,
  attrIsDynamic,
  attrStaticValue,
  getAttr,
  hasAttr,
  isElement,
  walkMarkup,
} from "../../parser/markup.js";
import { offsetToPosition } from "../../parser/lines.js";

const makeDiagnostic = (
  ctx: RuleContext,
  el: AstNode,
  rule: Rule,
  message?: string,
  help?: string,
): Diagnostic => {
  const { line, column } = offsetToPosition(ctx.source, el.start ?? 0);
  return {
    filePath: ctx.filePath,
    rule: rule.name,
    severity: rule.severity,
    message: message ?? rule.message,
    help: help ?? rule.help,
    line,
    column,
    category: rule.category,
  };
};

// images without intrinsic size reserve no space and push content around while
// loading, which is the most common source of layout shift on a page
const imgMissingDimensions: Rule = {
  name: "img-missing-dimensions",
  category: "Images",
  severity: "warning",
  message: "`<img>` has no intrinsic size, so it causes layout shift while loading",
  help: "Always set `width` and `height` so the browser can reserve space before the image arrives, or provide an `aspect-ratio` in CSS. Without one of these the surrounding content jumps when the image decodes (CLS).",
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "img") return;
      if (hasAttr(el, "width") && hasAttr(el, "height")) return;

      const style = attrStaticValue(getAttr(el, "style")) ?? "";
      if (/aspect-ratio/.test(style)) return;

      diagnostics.push(
        makeDiagnostic(
          ctx,
          el,
          imgMissingDimensions,
          "`<img>` has no `width`/`height`, so it causes layout shift while loading",
        ),
      );
    });

    return diagnostics;
  },
};

// below-the-fold images should defer until they are close to the viewport
const imgMissingLoading: Rule = {
  name: "img-missing-loading",
  category: "Images",
  severity: "warning",
  message: 'Below-the-fold `<img>` does not declare `loading="lazy"`',
  help: 'Add `loading="lazy"` to images that are not part of the initial viewport so the browser defers them off the critical path. Keep the hero image eager.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    let index = 0;

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "img") return;
      const position = index++;
      if (hasAttr(el, "loading")) return;
      // the first image is usually the LCP element and must stay eager
      if (position === 0) return;
      // dynamic images (inside {#each}) cannot be verified per-instance
      if (attrIsDynamic(el, "src")) return;

      diagnostics.push(makeDiagnostic(ctx, el, imgMissingLoading));
    });

    return diagnostics;
  },
};

// lazy-loading the hero delays the largest paint
const imgLazyLcp: Rule = {
  name: "img-lazy-lcp",
  category: "Images",
  severity: "warning",
  message: "The first image on the page is lazy-loaded, which delays the largest paint",
  help: 'The first image is normally the LCP element, so remove `loading="lazy"` and add `fetchpriority="high"` instead. Lazy loading it pushes the largest paint later and worsens LCP.',
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    const diagnostics: Diagnostic[] = [];
    let first: AstNode | null = null;

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "img") return;
      if (!first) first = el;
    });

    if (!first) return diagnostics;
    const value = attrStaticValue(getAttr(first, "loading"));
    if (value !== "lazy") return diagnostics;

    diagnostics.push(
      makeDiagnostic(
        ctx,
        first,
        imgLazyLcp,
        "The first image on the page is lazy-loaded, which delays the largest paint",
        'Remove `loading="lazy"` from the first image and use `fetchpriority="high"` instead.',
      ),
    );

    return diagnostics;
  },
};

// SvelteKit ships an enhanced-image pipeline that emits srcset/sizes automatically
const preferEnhancedImg: Rule = {
  name: "prefer-enhanced-img",
  category: "Images",
  severity: "warning",
  message: "`<img>` serves a single resolution, so every viewport downloads the full-size asset",
  help: "Use `@sveltejs/enhanced-img` (`<enhanced:img src={...}>`) so SvelteKit emits avif/webp variants with `srcset` and `sizes`, or add `srcset` by hand. A single-resolution `<img>` wastes bandwidth on mobile and slows LCP.",
  requiresAst: true,
  check: (ctx) => {
    if (!ctx.ast) return [];
    if (ctx.projectInfo.framework !== "sveltekit") return [];
    const diagnostics: Diagnostic[] = [];

    walkMarkup(ctx.ast.fragment?.nodes ?? [], [], (el) => {
      if (!isElement(el) || el.name !== "img") return;
      if (hasAttr(el, "srcset")) return;

      const src = attrStaticValue(getAttr(el, "src"));
      // only local, optimizable assets; external/data URLs are out of scope
      if (src === null) return;
      if (!src.startsWith("/")) return;

      diagnostics.push(makeDiagnostic(ctx, el, preferEnhancedImg));
    });

    return diagnostics;
  },
};

export const imageRules: Rule[] = [
  imgMissingDimensions,
  imgMissingLoading,
  imgLazyLcp,
  preferEnhancedImg,
];
