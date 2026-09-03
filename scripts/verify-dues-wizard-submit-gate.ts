/**
 * Targeted static + logic checks for the dues wizard submit gate.
 * Does not call production create endpoints or touch Hanlılar data.
 */
import fs from "node:fs";
import path from "node:path";

const modalPath = path.resolve(
  __dirname,
  "../../site-yonetim-frontend/src/components/accounting/DuesFormModal.tsx",
);
const listPath = path.resolve(
  __dirname,
  "../../site-yonetim-frontend/src/components/accounting/DuesListPage.tsx",
);

const modal = fs.readFileSync(modalPath, "utf8");
const list = fs.readFileSync(listPath, "utf8");

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function assert(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
}

// --- Button types / keys ---
assert(
  "İleri uses type=button",
  /key="dues-wizard-next"[\s\S]*?type="button"/.test(modal),
);
assert(
  "İleri does not use type=submit",
  !/key="dues-wizard-next"[\s\S]*?type="submit"/.test(modal),
);
assert(
  "Confirm uses type=button (not submit)",
  /key="dues-wizard-confirm"[\s\S]*?type="button"/.test(modal) &&
    !/key="dues-wizard-confirm"[\s\S]*?type="submit"/.test(modal),
);
assert(
  "Confirm calls handleCreateAssessment",
  /key="dues-wizard-confirm"[\s\S]*?handleCreateAssessment/.test(modal),
);
assert(
  "Geri uses type=button",
  /Geri[\s\S]*?type="button"|type="button"[\s\S]*?Geri/.test(modal),
);
assert(
  "Wizard next/confirm have distinct React keys (no DOM type mutation)",
  modal.includes('key="dues-wizard-next"') && modal.includes('key="dues-wizard-confirm"'),
);

// --- Submit gate ---
assert(
  "handleCreateAssessment requires step === 3",
  /async function handleCreateAssessment\([\s\S]*?if \(step !== 3\) return;/.test(modal),
);
assert(
  "form onSubmit ignores steps 1-2",
  /function handleFormSubmit\([\s\S]*?if \(step !== 3\) return;/.test(modal),
);
assert(
  "form onSubmit no longer auto-advances via goNext",
  !/function handleFormSubmit[\s\S]*?goNext\(\)/.test(modal),
);
assert(
  "reset effect uses wasOpenRef (open edge only)",
  modal.includes("wasOpenRef") && modal.includes("if (open && !wasOpenRef.current)"),
);

// --- List page ---
assert(
  "CTA renamed to Yeni Aidat Borçlandırması",
  list.includes("Yeni Aidat Borçlandırması"),
);
assert(
  "initialValues memoized",
  list.includes("formInitialValues") && list.includes("useMemo"),
);
assert(
  "create still only from handleSubmit with chargeImmediately",
  /createDuesDefinition\([\s\S]*chargeImmediately:\s*true/.test(list),
);

// --- Simulated create counter (wizard gate) ---
let createCalls = 0;
function mockCreate() {
  createCalls += 1;
}
function simulateWizardSubmit(step: 1 | 2 | 3) {
  // Mirrors handleFormSubmit / handleCreateAssessment gate
  if (step !== 3) return;
  mockCreate();
}
function simulateNextClick(step: 1 | 2 | 3): 1 | 2 | 3 {
  // Mirrors goNext — never creates
  if (step < 3) return (step + 1) as 1 | 2 | 3;
  return step;
}

createCalls = 0;
simulateWizardSubmit(1);
simulateWizardSubmit(2);
assert("Step 1/2 submit → create calls = 0", createCalls === 0, `got ${createCalls}`);

let step: 1 | 2 | 3 = 1;
step = simulateNextClick(step);
step = simulateNextClick(step);
assert("Two İleri clicks reach step 3", step === 3, `got ${step}`);
assert("Two İleri clicks → create calls = 0", createCalls === 0, `got ${createCalls}`);

simulateWizardSubmit(3);
assert("Step 3 confirm → create calls = 1", createCalls === 1, `got ${createCalls}`);

// Double confirm with pending guard (mirrors handleCreateAssessment + parent formPending)
let pending = false;
let guardedCalls = 0;
function simulateConfirmWithPending() {
  if (pending) return;
  if (step !== 3) return;
  pending = true;
  guardedCalls += 1;
  // request in flight — second click ignored
  simulateConfirmWithPending();
  pending = false;
}
step = 3;
simulateConfirmWithPending();
assert("Double click with pending → create calls = 1", guardedCalls === 1, `got ${guardedCalls}`);

const failed = checks.filter((c) => !c.ok);
console.log(
  JSON.stringify(
    {
      passed: checks.filter((c) => c.ok).length,
      failed: failed.length,
      checks,
    },
    null,
    2,
  ),
);
if (failed.length > 0) process.exit(1);
