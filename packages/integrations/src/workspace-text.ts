const COMMANDS: Record<string, string> = {
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  Sigma: "Σ",
  phi: "φ",
  Phi: "Φ",
  psi: "ψ",
  Psi: "Ψ",
  omega: "ω",
  Omega: "Ω",
  hbar: "ℏ",
  cdot: "·",
  times: "×",
  div: "÷",
  pm: "±",
  mp: "∓",
  geq: "≥",
  ge: "≥",
  leq: "≤",
  le: "≤",
  neq: "≠",
  approx: "≈",
  sim: "∼",
  infty: "∞",
  partial: "∂",
  nabla: "∇",
  sum: "∑",
  prod: "∏",
  int: "∫",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  implies: "⇒",
  in: "∈",
  notin: "∉",
};

const SUBSCRIPT: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
  n: "ⁿ",
};

function script(value: string, table: Record<string, string>): string {
  const converted = [...value].map((char) => table[char] ?? char).join("");
  return converted;
}
function replaceFractions(value: string): string {
  let current = value;
  for (let pass = 0; pass < 6; pass += 1) {
    const next = current.replace(
      /\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/gu,
      (_match, numerator: string, denominator: string) => {
        const top = numerator.trim();
        const bottom = denominator.trim();
        return `${top.length > 1 ? `(${top})` : top}/${bottom.length > 1 ? `(${bottom})` : bottom}`;
      },
    );
    if (next === current) break;
    current = next;
  }
  return current;
}

/** Convert common LLM LaTeX into readable Unicode for Workspace products. */
export function normalizeWorkspaceMath(value: string): string {
  let text = value
    .replace(/\\(?:\(|\)|\[|\])/gu, "")
    .replace(/\$\$?/gu, "")
    .replace(/\\(?:text|mathrm|mathbf|operatorname)\s*\{([^{}]*)\}/gu, "$1")
    .replace(/\\sqrt\s*\{([^{}]+)\}/gu, "√($1)");

  for (const [command, symbol] of Object.entries(COMMANDS)) {
    text = text.replace(new RegExp(`\\\\${command}(?![A-Za-z])`, "gu"), symbol);
  }
  text = replaceFractions(text);
  text = text
    .replace(/\\?_\{([0-9+\-=()]+)\}/gu, (_match, body: string) => script(body, SUBSCRIPT))
    .replace(/\\?_([0-9])/gu, (_match, body: string) => script(body, SUBSCRIPT))
    .replace(/\^\{([0-9+\-=()n]+)\}/gu, (_match, body: string) => script(body, SUPERSCRIPT))
    .replace(/\^([0-9n])/gu, (_match, body: string) => script(body, SUPERSCRIPT))
    .replace(/\\([{}_%&#])/gu, "$1")
    .replace(/[{}]/gu, "")
    .replace(/\\([A-Za-z]+)/gu, "$1")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/^\s*\\\s*$/gmu, "")
    .trim();

  return text;
}

/** Remove lightweight emphasis markers where an API surface styles by layout. */
export function plainWorkspaceText(value: string): string {
  return normalizeWorkspaceMath(value)
    .replace(/<u>([\s\S]*?)<\/u>/giu, "$1")
    .replace(/\*\*\*([\s\S]*?)\*\*\*/gu, "$1")
    .replace(/\*\*([\s\S]*?)\*\*/gu, "$1")
    .replace(/\*([^*\n]+)\*/gu, "$1")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/^\s*---+\s*$/gmu, "")
    .trim();
}
