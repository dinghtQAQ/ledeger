const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

function isCalendarDate(year: number, month: number, day: number): boolean {
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isStrictIsoDateTime(value: string): boolean {
	const match = ISO_DATE_TIME.exec(value);
	if (!match) return false;

	const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	if (!isCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return false;
	if (offset !== 'Z') {
		const offsetHour = Number(offset.slice(1, 3));
		const offsetMinute = Number(offset.slice(4, 6));
		if (offsetHour > 23 || offsetMinute > 59) return false;
	}
	return !Number.isNaN(Date.parse(value));
}

export function isCalendarDateString(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	return isCalendarDate(year, month, day);
}

export function localDateToUtc(date: string, timezone: string): string {
	if (!isCalendarDateString(date)) throw new Error('invalid date');
	const [year, month, day] = date.split('-').map(Number);
	const guess = Date.UTC(year, month - 1, day);
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		hour12: false,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
	}).formatToParts(new Date(guess));
	const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
	const hour = values.hour === 24 ? 0 : values.hour;
	const represented = Date.UTC(values.year, values.month - 1, values.day, hour, values.minute, values.second);
	return new Date(guess - (represented - guess)).toISOString();
}
