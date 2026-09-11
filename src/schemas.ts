import { z } from '@hono/zod-openapi';
import { isCalendarDateString, isStrictIsoDateTime } from './time';

export const errorSchema = z
	.object({
		error: z.object({ message: z.string() }),
	})
	.openapi('Error');

const isoDateTimeSchema = z
	.string()
	.refine(isStrictIsoDateTime, 'must be an ISO 8601 date-time with timezone')
	.openapi({ format: 'date-time', example: '2026-09-01T01:02:03+00:00' });

const amountSchema = z
	.string()
	.trim()
	.regex(/^\d+(?:\.\d+)?$/, 'must be a non-negative decimal string')
	.openapi({ example: '100.0016', description: 'RMB decimal string; rounded half-up to four decimals.' });

export const createEntrySchema = z
	.object({
		type: z.enum(['income', 'expense']).openapi({ example: 'expense' }),
		amount: amountSchema,
		occurredAt: isoDateTimeSchema,
		dueAt: isoDateTimeSchema.optional(),
		category: z.string().nullable().optional(),
		categoryId: z.coerce.number().int().positive().nullable().optional(),
		subcategoryId: z.coerce.number().int().positive().nullable().optional(),
		note: z.string().nullable().optional(),
	})
	.superRefine((value, context) => {
		if (value.dueAt) context.addIssue({ code: 'custom', path: ['dueAt'], message: 'dueAt is only valid for legacy due_expense entries' });
	})
	.openapi('CreateEntry');

export const shortcutCreateEntrySchema = z
	.object({
		type: z.enum(['income', 'expense']).openapi({ example: 'expense' }),
		amount: amountSchema,
		occurredAt: isoDateTimeSchema,
		category: z.string().nullable().optional(),
		categoryId: z.coerce.number().int().positive().nullable().optional(),
		subcategoryId: z.coerce.number().int().positive().nullable().optional(),
		note: z.string().nullable().optional(),
	})
	.strict()
	.openapi('ShortcutCreateEntry');

export const createEntryBatchSchema = z
	.object({ entries: z.array(createEntrySchema).min(1).max(50) })
	.openapi('CreateEntryBatch');

export const entrySchema = z
	.object({
		id: z.string().openapi({ example: '8f4c1b2a-7db8-4c48-8b8f-2c51d10b1c2f' }),
		type: z.enum(['income', 'expense', 'due_expense']),
		amount: z.string(),
		displayAmount: z.string().openapi({ description: 'Amount rounded half-up to three decimals.' }),
		occurredAt: z.string().datetime({ offset: true }),
		dueAt: z.string().datetime({ offset: true }).nullable(),
		dueStatus: z.enum(['unpaid', 'paid', 'cancelled']).nullable(),
		category: z.string().nullable(),
		categoryId: z.number().int().positive().nullable().optional(),
		subcategoryId: z.number().int().positive().nullable().optional(),
		note: z.string().nullable(),
		isReversal: z.boolean(),
		reversalOf: z.string().nullable(),
		reversedAt: z.string().datetime({ offset: true }).nullable(),
		version: z.number().int(),
		createdAt: z.string().datetime({ offset: true }),
		updatedAt: z.string().datetime({ offset: true }),
	})
	.openapi('Entry');

export const entryResponseSchema = z.object({ entry: entrySchema }).openapi('EntryResponse');
export const entryBatchResponseSchema = z.object({ entries: z.array(entrySchema) }).openapi('EntryBatchResponse');
export const entryDetailResponseSchema = z
	.object({ entry: entrySchema, relatedEntry: entrySchema.nullable() })
	.openapi('EntryDetailResponse');
export const reversalResponseSchema = z.object({ entry: entrySchema, reversal: entrySchema }).openapi('ReversalResponse');
export const entryPageSchema = z.object({ items: z.array(entrySchema), nextCursor: z.string().nullable() }).openapi('EntryPage');

export const idParamSchema = z.object({ id: z.string().min(1) });

export const listQuerySchema = z.object({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	from: z.string().refine(isCalendarDateString, 'must be a valid calendar date').optional(),
	to: z.string().refine(isCalendarDateString, 'must be a valid calendar date').optional(),
	category: z.string().optional(),
	type: z.enum(['income', 'expense', 'due_expense']).optional(),
	categoryId: z.coerce.number().int().positive().optional(),
	subcategoryId: z.coerce.number().int().positive().optional(),
	sort: z.enum(['occurredAt.desc', 'occurredAt.asc', 'createdAt.desc', 'amount.desc', 'amount.asc']).default('occurredAt.desc'),
});

export const healthSchema = z.object({ status: z.string() }).openapi('Health');

export const authLoginSchema = z
	.object({
		password: z.string().min(1),
		turnstileToken: z.string().min(1),
	})
	.openapi('AuthLogin');

export const authSessionSchema = z
	.object({
		authenticated: z.boolean(),
		expiresAt: z.string().datetime({ offset: true }).optional(),
	})
	.openapi('AuthSession');

export const coarseCategorySchema = z.object({ id: z.number().int().positive(), name: z.string() }).openapi('CoarseCategory');
export const fineCategorySchema = z
	.object({
		id: z.number().int().positive(),
		name: z.string(),
		coarseCategoryId: z.number().int().positive(),
		sortOrder: z.number().int(),
		isActive: z.boolean(),
	})
	.openapi('FineCategory');
export const categoriesResponseSchema = z
	.object({ coarseCategories: z.array(coarseCategorySchema), fineCategories: z.array(fineCategorySchema) })
	.openapi('CategoriesResponse');
export const fineCategoryCreateSchema = z.object({
	name: z.string().trim().min(1).max(100),
	coarseCategoryId: z.coerce.number().int().positive(),
	sortOrder: z.coerce.number().int().optional(),
});
export const fineCategoryPatchSchema = z
	.object({ name: z.string().trim().min(1).max(100).optional(), sortOrder: z.coerce.number().int().optional() })
	.refine((value) => value.name !== undefined || value.sortOrder !== undefined, 'at least one field is required');
export const ledgerSettingsSchema = z
	.object({ paydayDay: z.number().int().min(1).max(28), timezone: z.string() })
	.openapi('LedgerSettings');
export const ledgerSettingsUpdateSchema = z.object({
	paydayDay: z.coerce.number().int().min(1).max(28).optional(),
	paydayAnchor: z.coerce.number().int().min(1).max(28).optional(),
	payday: z.coerce.number().int().min(1).max(28).optional(),
})
	.refine((value) => value.paydayDay !== undefined || value.paydayAnchor !== undefined || value.payday !== undefined, 'paydayDay is required');

export const analyticsSummaryQuerySchema = z.object({
	from: z.string().refine(isCalendarDateString, 'must be a valid calendar date'),
	to: z.string().refine(isCalendarDateString, 'must be a valid calendar date'),
	level: z.enum(['coarse', 'fine']).default('coarse'),
});

export const analyticsItemSchema = z.object({
	id: z.number().int().positive().nullable(),
	name: z.string(),
	parentId: z.number().int().positive().optional(),
	parentName: z.string().optional(),
	amount: z.string(),
	displayAmount: z.string(),
	count: z.number().int().nonnegative(),
});

export const analyticsSummarySchema = z.object({
	from: z.string(),
	to: z.string(),
	periodIncome: z.string(),
	periodExpense: z.string(),
	periodNet: z.string(),
	currentBalance: z.string(),
	items: z.array(analyticsItemSchema),
}).openapi('AnalyticsSummary');
