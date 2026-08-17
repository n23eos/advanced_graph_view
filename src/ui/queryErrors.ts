/** One place that turns a QueryDiagnostic into a localized message, shared by
 *  the search bar and the preset modal. */
import { t } from "../i18n";
import type { QueryDiagnostic } from "../query/QueryParser";

export function queryErrorText(error: QueryDiagnostic): string {
	return error.messageKey === "unclosedQuote"
		? t("search.error.unclosedQuote")
		: t("search.error.badValue", { operator: error.operator });
}
