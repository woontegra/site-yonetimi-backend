import type { NextFunction, Request, Response } from "express";
import { assertSiteActive, siteIdFrom } from "../middleware/site";
import { bankAccountService } from "../services/bank-account.service";
import { bankMatchingRuleService } from "../services/bank-matching-rule.service";
import { bankTransactionService } from "../services/bank-transaction.service";
import { HttpError } from "../utils/httpError";
import {
  createBankAccountSchema,
  createBankMatchingRuleSchema,
  createBankTransactionSchema,
  listBankAccountsQuerySchema,
  listBankMatchingRulesQuerySchema,
  listBankTransactionsQuerySchema,
  matchBankTransactionSchema,
  processBankTransactionSchema,
  updateBankAccountSchema,
  updateBankMatchingRuleSchema,
} from "../validators/bank.validators";

function tenantIdFrom(req: Request): string {
  const tenantId = req.auth?.tenantId;
  if (!tenantId) throw new HttpError(400, "Aktif hesap seçilmedi.");
  return tenantId;
}

function firstZodMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Geçersiz istek.";
}

export async function listBankAccounts(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listBankAccountsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res.status(200).json(await bankAccountService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const bankAccount = await bankAccountService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ bankAccount });
  } catch (error) {
    next(error);
  }
}

export async function createBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createBankAccountSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const bankAccount = await bankAccountService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ bankAccount });
  } catch (error) {
    next(error);
  }
}

export async function updateBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateBankAccountSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const bankAccount = await bankAccountService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ bankAccount });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankAccount(req: Request, res: Response, next: NextFunction) {
  try {
    await bankAccountService.softDelete(tenantIdFrom(req), siteIdFrom(req), String(req.params.id));
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function listBankTransactions(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listBankTransactionsQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await bankTransactionService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function getBankTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const bankTransaction = await bankTransactionService.getById(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ bankTransaction });
  } catch (error) {
    next(error);
  }
}

export async function createBankTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createBankTransactionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const bankTransaction = await bankTransactionService.createManual(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ bankTransaction });
  } catch (error) {
    next(error);
  }
}

export async function matchBankTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = matchBankTransactionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const bankTransaction = await bankTransactionService.match(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ bankTransaction });
  } catch (error) {
    next(error);
  }
}

export async function processBankTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = processBankTransactionSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const bankTransaction = await bankTransactionService.process(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ bankTransaction });
  } catch (error) {
    next(error);
  }
}

export async function ignoreBankTransaction(req: Request, res: Response, next: NextFunction) {
  try {
    const bankTransaction = await bankTransactionService.ignore(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ bankTransaction });
  } catch (error) {
    next(error);
  }
}

export async function listBankMatchingRules(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listBankMatchingRulesQuerySchema.safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    res
      .status(200)
      .json(await bankMatchingRuleService.list(tenantIdFrom(req), siteIdFrom(req), parsed.data));
  } catch (error) {
    next(error);
  }
}

export async function createBankMatchingRule(req: Request, res: Response, next: NextFunction) {
  try {
    assertSiteActive(req);
    const parsed = createBankMatchingRuleSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const rule = await bankMatchingRuleService.create(
      tenantIdFrom(req),
      siteIdFrom(req),
      parsed.data,
    );
    res.status(201).json({ rule });
  } catch (error) {
    next(error);
  }
}

export async function updateBankMatchingRule(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateBankMatchingRuleSchema.safeParse(req.body);
    if (!parsed.success) throw new HttpError(400, firstZodMessage(parsed.error));
    const rule = await bankMatchingRuleService.update(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
      parsed.data,
    );
    res.status(200).json({ rule });
  } catch (error) {
    next(error);
  }
}

export async function deleteBankMatchingRule(req: Request, res: Response, next: NextFunction) {
  try {
    await bankMatchingRuleService.softDelete(
      tenantIdFrom(req),
      siteIdFrom(req),
      String(req.params.id),
    );
    res.status(200).json({ ok: true });
  } catch (error) {
    next(error);
  }
}
