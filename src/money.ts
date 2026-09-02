const AMOUNT_PATTERN = /^(?:\d+)(?:\.\d+)?$/;

export class AmountError extends Error {}

function asString(value: unknown): string {
	if (typeof value === 'string') return value.trim();
	throw new AmountError('amount must be a decimal string');
}

function incrementDecimal(integer: string, fraction: string): [string, string] {
	let digits = BigInt(`${integer}${fraction || '0'}`) + 1n;
	const width = fraction.length || 1;
	let result = digits.toString().padStart(integer.length + width, '0');
	return [result.slice(0, -width), result.slice(-width)];
}

export function normalizeAmount(value: unknown): string {
	const input = asString(value);
	if (!AMOUNT_PATTERN.test(input)) {
		throw new AmountError('amount must be a non-negative decimal');
	}

	let [integer, fraction = ''] = input.split('.');
	integer = integer.replace(/^0+(?=\d)/, '');
	if (fraction.length > 4) {
		const kept = fraction.slice(0, 4);
		if (fraction[4] >= '5') {
			[integer, fraction] = incrementDecimal(integer, kept);
		} else {
			fraction = kept;
		}
	}
	const trimmedFraction = fraction.replace(/0+$/, '');
	const result = trimmedFraction ? `${integer}.${trimmedFraction}` : integer;
	if (amountToUnitsUnchecked(integer, trimmedFraction) <= 0n) {
		throw new AmountError('amount must be greater than zero');
	}
	return result;
}

function amountToUnitsUnchecked(integer: string, fraction: string): bigint {
	return BigInt(integer) * 10000n + BigInt(fraction.padEnd(4, '0'));
}

export function displayAmount(value: string): string {
	const canonical = normalizeAmount(value);
	let [integer, fraction = ''] = canonical.split('.');
	const padded = fraction.padEnd(4, '0');
	let displayFraction = padded.slice(0, 3);
	if (padded[3] >= '5') {
		let combined = BigInt(`${integer}${displayFraction}`) + 1n;
		const width = 3;
		let result = combined.toString().padStart(integer.length + width, '0');
		integer = result.slice(0, -width);
		displayFraction = result.slice(-width);
	}
	return `${integer}.${displayFraction}`;
}

export function amountToUnits(value: string): bigint {
	const canonical = normalizeAmount(value);
	let [integer, fraction = ''] = canonical.split('.');
	return amountToUnitsUnchecked(integer, fraction);
}

export function unitsToAmount(units: bigint): string {
	const negative = units < 0n;
	const absolute = negative ? -units : units;
	const integer = absolute / 10000n;
	const fraction = (absolute % 10000n).toString().padStart(4, '0').replace(/0+$/, '');
	const result = fraction ? `${integer}.${fraction}` : integer.toString();
	return negative ? `-${result}` : result;
}
