/**
 * Structured misconceptions (spec §12). Each wrong answer a question can predict is tagged with one
 * of these codes; the tutor uses the code for TARGETED remediation (not just "try again"), and
 * parents/teachers see which ideas a learner keeps tripping on.
 *
 * The same list is seeded into the `misconceptions` table by a migration; a test keeps the two in
 * step, so a code used by a question always exists in the database.
 */

export type MisconceptionTopic = "NUM" | "OPS" | "MEA" | "REL" | null;

export interface Misconception {
  code: string;
  name: string;
  /** What the learner is doing wrong, in teacher language. */
  description: string;
  topic: MisconceptionTopic;
  /** How to put it right: the strategy the tutor builds its correction around. */
  remediation: string;
  /** A first nudge in learner language. It points at WHERE to look and never gives the answer. */
  nudge: string;
}

export const MISCONCEPTIONS: readonly Misconception[] = [
  // ── the ten the specification names ───────────────────────────────────────────────────────
  {
    code: "PLACE_VALUE_CONFUSION",
    name: "Place value confusion",
    description:
      "Gives the digit instead of its value, or reads a digit's position wrongly (for example says the 7 in 4 703 is worth 7).",
    topic: "NUM",
    remediation:
      "Build the number in a place-value chart and say the value of each digit in words, then compare the digit with its value.",
    nudge:
      "Hmm, let's put the number in a place-value chart and look at which column the digit sits in.",
  },
  {
    code: "CARRYING_ERROR",
    name: "Carrying (regrouping) error in addition",
    description:
      "Forgets to carry, or carries into the wrong column, when a column adds to ten or more.",
    topic: "OPS",
    remediation:
      "Add column by column, writing the carried digit above the next column; check each column total before moving on.",
    nudge:
      "Let's look at the ones column first. What does it add up to, and does it need to move to the next column?",
  },
  {
    code: "BORROWING_ERROR",
    name: "Borrowing (regrouping) error in subtraction",
    description:
      "Subtracts the smaller digit from the larger in every column, or forgets to reduce the next column after borrowing.",
    topic: "OPS",
    remediation:
      "Rewrite the top number with the regrouped digits and check each column: can the bottom digit be taken from the top digit?",
    nudge:
      "Let's look at the ones column. Can you take that bottom digit away from the top one, or do we need to borrow?",
  },
  {
    code: "FRACTION_DENOMINATOR_CONFUSION",
    name: "Denominator confusion",
    description:
      "Adds or subtracts denominators as well as numerators, or thinks a bigger denominator means a bigger fraction.",
    topic: "NUM",
    remediation:
      "Show equal parts of the same whole with a fraction strip; the denominator names the size of the parts, so it is not added.",
    nudge:
      "Let's draw the two fractions on strips. What does the bottom number tell us about the size of each part?",
  },
  {
    code: "DECIMAL_PLACE_CONFUSION",
    name: "Decimal place confusion",
    description:
      "Misplaces the decimal point, or compares decimals as if they were whole numbers (thinks 0.35 is bigger than 0.4).",
    topic: "NUM",
    remediation:
      "Line the numbers up in a place-value chart with tenths, hundredths and thousandths, and compare column by column from the left.",
    nudge:
      "Let's write both numbers under a tenths and hundredths chart and compare the tenths first.",
  },
  {
    code: "UNIT_CONVERSION_ERROR",
    name: "Unit conversion error",
    description:
      "Multiplies or divides by the wrong power of ten (or the wrong way round) when changing between metric units.",
    topic: "MEA",
    remediation:
      "Decide first whether the new unit is bigger or smaller (so should the number be bigger or smaller?), then use the conversion fact.",
    nudge:
      "Before we calculate: is a metre bigger or smaller than a centimetre? So should your number get bigger or smaller?",
  },
  {
    code: "TIME_CONVERSION_ERROR",
    name: "Time conversion error",
    description:
      "Treats time as decimal (100 minutes in an hour) or confuses 12-hour and 24-hour clock times.",
    topic: "MEA",
    remediation:
      "Use a number line or clock face with 60-minute hours; for 24-hour times count on from 12.",
    nudge: "Hmm, how many minutes are there in one hour? Let's count the time on a clock face.",
  },
  {
    code: "AREA_VS_PERIMETER",
    name: "Area and perimeter confused",
    description:
      "Finds the distance around a shape when asked for the space inside it, or the other way round.",
    topic: "MEA",
    remediation:
      "Contrast them physically: perimeter is a fence around a field (length), area is the grass inside (squares).",
    nudge:
      "Let's think: are we measuring the edge all the way around, or the space inside the shape?",
  },
  {
    code: "ORDER_OF_OPERATIONS_ERROR",
    name: "Order of operations error",
    description:
      "Works strictly left to right, ignoring that multiplication and division come before addition and subtraction.",
    topic: "OPS",
    remediation:
      "Underline the multiplication or division first, work it out, then do the additions and subtractions; brackets come before everything.",
    nudge: "Let's look at the operations in the sum. Which one should we do first?",
  },
  {
    code: "GRAPH_READING_ERROR",
    name: "Graph or table reading error",
    description:
      "Reads the wrong bar, the wrong axis or the wrong scale step from a graph, or confuses a count with a category.",
    topic: "REL",
    remediation:
      "Find the label first, follow the bar to the scale with a finger or ruler, and check what one step on the scale is worth.",
    nudge:
      "Let's find the bar you need first, and then check what each step on the side scale is worth.",
  },
  // ── further misconceptions the question templates can predict ─────────────────────────────
  {
    code: "ZERO_PLACEHOLDER_ERROR",
    name: "Zero as a placeholder missed",
    description:
      "Leaves out a zero when writing a number from its words or expanded form (writes 405 for four thousand and five).",
    topic: "NUM",
    remediation:
      "Say each place out loud (thousands, hundreds, tens, ones) and write a zero for every empty place.",
    nudge: "Let's say each column in turn: thousands, hundreds, tens, ones. Is any column empty?",
  },
  {
    code: "FRACTION_SIZE_BY_DENOMINATOR",
    name: "Bigger denominator, bigger fraction",
    description: "Believes 1/8 is larger than 1/4 because 8 is larger than 4.",
    topic: "NUM",
    remediation:
      "Share the same whole into equal parts: more parts means smaller parts. Compare with fraction strips.",
    nudge:
      "Imagine one chapati cut into 4 pieces and an identical one cut into 8. Which pieces are bigger?",
  },
  {
    code: "ROUNDING_DIRECTION_ERROR",
    name: "Rounding in the wrong direction",
    description:
      "Rounds down when the next digit is 5 or more (or rounds up when it is below 5), or looks at the wrong digit.",
    topic: "NUM",
    remediation:
      "Find the digit to its right: 5 or more rounds up, less than 5 stays. Mark the two possible answers on a number line.",
    nudge: "Let's put the number on a number line between the two tens. Which ten is it closer to?",
  },
  {
    code: "BASIC_FACT_ERROR",
    name: "Basic fact error",
    description:
      "Recalls a multiplication or addition fact incorrectly although the method used is right.",
    topic: "OPS",
    remediation:
      "Rebuild the fact from one you know (double, add one more group, use 10×) and practise it in short rounds.",
    nudge:
      "Your method looks right. Let's check the times-table fact by building it from one you know well.",
  },
  {
    code: "DIVISION_REMAINDER_ERROR",
    name: "Remainder mishandled",
    description:
      "Ignores the remainder, or writes it as a decimal or in the wrong place, in a division.",
    topic: "OPS",
    remediation:
      "Check by multiplying back and adding the remainder; ask what the remainder means in the story.",
    nudge:
      "Let's check: multiply your answer by the divider and see what is left over from the number we started with.",
  },
  {
    code: "OPERATION_CHOICE_ERROR",
    name: "Wrong operation chosen",
    description:
      "Chooses addition, subtraction, multiplication or division that does not fit the situation in a word problem.",
    topic: null,
    remediation:
      "Retell the story in your own words, draw it, and ask what is being joined, taken away, shared or repeated.",
    nudge:
      "Let's tell the story again in our own words. Is something being joined together, taken away, shared out or repeated?",
  },
  {
    code: "HCF_LCM_CONFUSION",
    name: "HCF and LCM confused",
    description: "Finds a common multiple when asked for a common factor, or the other way round.",
    topic: "OPS",
    remediation:
      "List factors (numbers that divide in) and multiples (numbers that come out in the times table) separately for each number.",
    nudge:
      "Are we looking for numbers that divide INTO both of them, or numbers that both of them divide into?",
  },
  {
    code: "ANGLE_TYPE_CONFUSION",
    name: "Angle types confused",
    description:
      "Mixes up acute, right, obtuse and straight angles, or reads the wrong size from a turn.",
    topic: "MEA",
    remediation:
      "Compare every angle with a right angle (a corner of a page): smaller is acute, bigger is obtuse.",
    nudge:
      "Let's compare the angle with the corner of your book. Is it smaller or bigger than that corner?",
  },
  {
    code: "AVERAGE_CONFUSION",
    name: "Mean, median or mode confused",
    description:
      "Uses the wrong measure of the data (the most common value instead of the average, or the middle instead of the total shared out).",
    topic: "REL",
    remediation:
      "Say what each word means in plain words: mode is the most common, median the middle one in order, mean is the total shared equally.",
    nudge:
      "Let's remember what each word means: which one is 'most common', which one is 'in the middle'?",
  },
  // ── common errors in fractions, decimals and percentages ──────────────────────────────────
  {
    code: "FRACTION_NOTATION_CONFUSION",
    name: "Fraction written or read upside down",
    description:
      "Swaps the numerator and the denominator when writing or reading a fraction (three quarters as 4/3).",
    topic: "NUM",
    remediation:
      "The bottom number names the kind of part (quarters, fifths); the top number counts how many of them there are. Say the fraction in words before writing it.",
    nudge: "Let's say it in words: which number tells how many equal parts the whole is cut into?",
  },
  {
    code: "PART_WHOLE_CONFUSION",
    name: "Part compared with part, not with the whole",
    description:
      "Writes the shaded parts over the unshaded parts instead of over all the equal parts (3 shaded and 5 not shaded as 3/5, not 3/8).",
    topic: "NUM",
    remediation:
      "Count ALL the equal parts first: that is the denominator. Then count the shaded ones: that is the numerator.",
    nudge: "First count every equal part in the whole picture. How many are there altogether?",
  },
  {
    code: "FRACTION_COMPONENT_COMPARISON",
    name: "Numerators and denominators compared separately",
    description:
      "Compares fractions by looking at the tops and bottoms as separate whole numbers (thinks 2/3 is bigger than 3/8 because 3 is bigger than 2, or ignores the denominators).",
    topic: "NUM",
    remediation:
      "Rewrite both fractions with the same denominator, or draw them on equal strips, and then compare the numerators.",
    nudge:
      "Let's give both fractions the same bottom number first. What number do both denominators go into?",
  },
  {
    code: "EQUIVALENT_FRACTION_ADDITIVE_ERROR",
    name: "Adds instead of multiplying to make an equivalent fraction",
    description:
      "Adds the same number to the numerator and the denominator (1/2 → 3/4) instead of multiplying both by the same number.",
    topic: "NUM",
    remediation:
      "Equivalent fractions name the same amount: both numbers are multiplied (or divided) by the same number. Check with fraction strips.",
    nudge:
      "To keep the same amount, what must we do to the top and bottom: add the same number, or multiply by it?",
  },
  {
    code: "MIXED_IMPROPER_CONVERSION_ERROR",
    name: "Mixed number and improper fraction mixed up",
    description:
      "Converts between mixed numbers and improper fractions wrongly: forgets to multiply the whole number by the denominator, or adds the whole number to the numerator.",
    topic: "NUM",
    remediation:
      "Think of the wholes as parts: each whole holds as many parts as the denominator says. Count all the parts, then write them over the denominator.",
    nudge:
      "How many equal parts are there in ONE whole? So how many parts are there in the whole numbers?",
  },
  {
    code: "PERCENT_CONVERSION_ERROR",
    name: "Percentage conversion error",
    description:
      "Changes between fractions, decimals and percentages with the wrong factor (writes 1/4 as 14% or 4%).",
    topic: "NUM",
    remediation:
      "A percentage is a fraction out of 100. Make the denominator 100 first (or divide 100 by the denominator) and read off the numerator.",
    nudge: "Percent means 'out of 100'. How many hundredths is the same as this fraction?",
  },
  {
    code: "FRACTION_MULTIPLICATION_ERROR",
    name: "Fraction multiplication error",
    description:
      "Finds a common denominator before multiplying, adds the numerators, or multiplies only the numerators.",
    topic: "OPS",
    remediation:
      "To multiply fractions, multiply the numerators together and the denominators together. A common denominator is only needed for adding and subtracting.",
    nudge:
      "When we multiply fractions, what do we do with the tops, and what do we do with the bottoms?",
  },
  {
    code: "FRACTION_OF_QUANTITY_ERROR",
    name: "Stops after dividing by the denominator",
    description:
      "Finds one part (divides by the denominator) but forgets to take the number of parts the numerator asks for, or does it the wrong way round.",
    topic: "OPS",
    remediation:
      "Divide by the denominator to find one equal part, then multiply by the numerator to take that many parts.",
    nudge: "Dividing gives the size of ONE part. How many parts does the fraction ask for?",
  },
  {
    code: "MULTIPLICATION_PLACE_ERROR",
    name: "Partial products misplaced in long multiplication",
    description:
      "Forgets the zero placeholder (or misaligns the rows) when multiplying by a tens digit, so the partial product is ten times too small.",
    topic: "OPS",
    remediation:
      "Multiplying by the tens digit is really multiplying by tens: write a 0 in the ones place of that row first.",
    nudge:
      "The second row is multiplied by tens, not ones. What must we write in the ones column of that row?",
  },
  {
    code: "PROFIT_LOSS_CONFUSION",
    name: "Profit and loss confused",
    description:
      "Calls a loss a profit (or the other way round), or subtracts the selling price and the cost price in the wrong order.",
    topic: "MEA",
    remediation:
      "Compare the selling price with the cost price: more than the cost is a profit, less is a loss. Always take the smaller from the bigger.",
    nudge: "Did the seller get back more money than was paid, or less?",
  },
  {
    code: "RATE_FORMULA_ERROR",
    name: "Speed, distance and time formula wrong",
    description:
      "Uses the wrong operation for speed, distance or time (for example multiplies distance by time to find speed).",
    topic: "MEA",
    remediation:
      "Use the triangle D / (S × T): cover what you want to find. Speed is distance shared by time; distance is speed times time.",
    nudge: "Speed tells how far we go in ONE hour. Do we share the distance out, or repeat it?",
  },
  {
    code: "ANGLE_SUM_ERROR",
    name: "Wrong total for angles",
    description:
      "Uses the wrong total when finding a missing angle (360° on a straight line instead of 180°, or 180° around a point).",
    topic: "MEA",
    remediation:
      "Angles on a straight line make a half turn (180°), angles at a point make a full turn (360°), angles in a triangle make 180°. Find the right total first, then subtract.",
    nudge: "What is the total of the angles in this kind of figure: a half turn or a full turn?",
  },
  {
    code: "PERIMETER_SIDES_MISSED",
    name: "Not all sides added for the perimeter",
    description:
      "Adds only the sides that are marked (for example length + width of a rectangle) and misses the equal sides that are not marked.",
    topic: "MEA",
    remediation:
      "Walk round the shape with a finger and count every side. Mark each side that has an equal partner and add all of them.",
    nudge: "Let's walk all the way round the shape. How many sides does it have altogether?",
  },
  {
    code: "CLOCK_READING_ERROR",
    name: "Clock hands misread",
    description:
      "Reads the minute hand as hours or counts the number the hand points at as minutes (reads 9 as 9 minutes), or reads the wrong hour when the hour hand is between two numbers.",
    topic: "MEA",
    remediation:
      "Look at the short hand for the hour, then at the long hand: each number on the clock face is 5 minutes, so count in fives.",
    nudge:
      "Let's look at the short hand first. Which hour has it just passed? Then count the minutes in fives with the long hand.",
  },
  {
    code: "RULER_START_ERROR",
    name: "Length read from the wrong starting mark",
    description:
      "Reads the mark where the line ends instead of working out its length when the line does not start at 0.",
    topic: "MEA",
    remediation:
      "A length is the distance from where the line starts to where it ends: read both marks and find the difference, or slide the line back to 0.",
    nudge: "Where does the line start on the ruler? Is it at the zero mark?",
  },
  {
    code: "VOLUME_AREA_CONFUSION",
    name: "Volume found as area or by adding",
    description:
      "Multiplies only two of the three measurements (the area of one face) or adds the length, width and height instead of multiplying all three.",
    topic: "MEA",
    remediation:
      "Volume counts the cubes that fill the solid: layers of length × width, and as many layers as the height. Multiply all three measurements.",
    nudge:
      "A solid has three measurements. How many layers of cubes fill it, and how many cubes are in each layer?",
  },
] as const;

export const MISCONCEPTION_CODES = MISCONCEPTIONS.map((m) => m.code);

const BY_CODE = new Map(MISCONCEPTIONS.map((m) => [m.code, m]));

export function getMisconception(code: string): Misconception | undefined {
  return BY_CODE.get(code);
}

export function isMisconceptionCode(code: string): boolean {
  return BY_CODE.has(code);
}

/** SQL that seeds the `misconceptions` table from this registry (used to generate and verify the migration). */
export function misconceptionsSql(): string {
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const rows = MISCONCEPTIONS.map(
    (m) =>
      `  (${q(m.code)}, ${q(m.name)}, ${q(m.description)}, ${m.topic ? q(m.topic) : "null"}, ${q(m.remediation)})`,
  );
  return `insert into public.misconceptions (code, name, description, topic_code, remediation) values\n${rows.join(",\n")}\non conflict (code) do update set\n  name = excluded.name, description = excluded.description,\n  topic_code = excluded.topic_code, remediation = excluded.remediation;\n`;
}
