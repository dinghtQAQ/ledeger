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
		type: z.enum(['income', 'expense', 'due_expense']).openapi({ example: 'expense' }),
		amount: amountSchema,
		occurredAt: isoDateTimeSchema,
		dueAt: isoDateTimeSchema.optional(),
		category: z.string().nullable().optional(),
		note: z.string().nullable().optional(),
	})
	.superRefine((value, context) => {
		if (value.type === 'due_expense' && !value.dueAt) {
			context.addIssue({ code: 'custom', path: ['dueAt'], message: 'dueAt is required for due_expense' });
		}
		if (value.type !== 'due_expense' && value.dueAt) {
			context.addIssue({ code: 'custom', path: ['dueAt'], message: 'dueAt is only valid for due_expense' });
		}
	})
	.openapi('CreateEntry');

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
export const reversalResponseSchema = z.object({ entry: entrySchema, reversal: entrySchema }).openapi('ReversalResponse');
export const entryPageSchema = z.object({ items: z.array(entrySchema), nextCursor: z.string().nullable() }).openapi('EntryPage');

export const idParamSchema = z.object({ id: z.string().min(1) });

export const listQuerySchema = z.object({
	cursor: z.string().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50),
	from: z.string().refine(isCalendarDateString, 'must be a valid calendar date').optional(),
	to: z.string().refine(isCalendarDateString, 'must be a valid calendar date').optional(),
	category: z.string().optional(),
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
