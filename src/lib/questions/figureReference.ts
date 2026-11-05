/**
 * Does a question point at something printed on the paper that the system cannot see: a figure, a graph, a table, a
 * circuit, a map? The marking scheme is drafted from the question's words alone, so for such a question it is a guess
 * about what the figure shows, and a wrong scheme means wrong marks for the whole class. The teacher approves every
 * scheme (D8); this tells them which ones to read most carefully.
 *
 * Deliberately narrow. "Draw a diagram of the heart" mentions a diagram the student makes, not one the question shows,
 * so only phrases that point at an existing one count: "in the figure", "the graph below", "shown in Fig. 2",
 * "refer to the table". A false alarm costs a moment's attention; a miss costs a silent guess, so it errs towards alarm
 * for those pointing phrases and stays quiet for plain mentions.
 *
 * Pure: no model, no database.
 */

const THING = "(?:fig(?:ure)?\\.?\\s*\\d*[a-z]?|diagram|graph|chart|table|circuit(?:\\s+diagram)?|map|picture|image|photograph|illustration|number\\s+line)";

const POINTING: RegExp[] = [
  // "in the figure", "from the graph", "using the table", "refer to Fig. 2", "see the diagram", "according to the chart"
  new RegExp(`\\b(?:in|from|using|use|refer(?:\\s+to)?|see|study|observe|examine|according\\s+to|with\\s+the\\s+help\\s+of|based\\s+on)\\s+(?:the\\s+|this\\s+|given\\s+|above\\s+|following\\s+)*${THING}\\b`, "i"),
  // "the figure below", "the graph given", "the table shown", "the diagram above"
  new RegExp(`\\b(?:the|this|a)\\s+${THING}\\s+(?:given|shown|below|above|alongside|drawn|attached|provided)\\b`, "i"),
  // "shown below", "given below", "as shown", "in the adjoining figure"
  /\b(?:adjoining|adjacent|accompanying|following)\s+(?:figure|diagram|graph|table|circuit|map|chart)\b/i,
  /\bas\s+shown\b/i,
  /\b(?:shown|given|drawn|displayed)\s+(?:below|above|alongside)\b/i,
];

export function referencesFigure(questionText: string): boolean {
  if (!questionText) return false;
  return POINTING.some((pattern) => pattern.test(questionText));
}

/** The note shown beside a scheme drafted for a question that points at a figure. */
export const FIGURE_REFERENCE_NOTE =
  "This question points at a figure, graph or table that Assessment Brain cannot see. The scheme was drafted from the words alone, so read it carefully before approving, or put what the figure shows into the question.";
