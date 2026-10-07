-- ZimTutor 0014: misconception reference data, and the two facts the mastery engine needs per objective.
--
-- The misconceptions below are generated from src/lib/misconceptions/registry.ts
-- (`npx tsx scripts/misconceptions-sql.ts`); tests/db/misconceptions.test.ts keeps the two identical.

insert into public.misconceptions (code, name, description, topic_code, remediation) values
  ('PLACE_VALUE_CONFUSION', 'Place value confusion', 'Gives the digit instead of its value, or reads a digit''s position wrongly (for example says the 7 in 4 703 is worth 7).', 'NUM', 'Build the number in a place-value chart and say the value of each digit in words, then compare the digit with its value.'),
  ('CARRYING_ERROR', 'Carrying (regrouping) error in addition', 'Forgets to carry, or carries into the wrong column, when a column adds to ten or more.', 'OPS', 'Add column by column, writing the carried digit above the next column; check each column total before moving on.'),
  ('BORROWING_ERROR', 'Borrowing (regrouping) error in subtraction', 'Subtracts the smaller digit from the larger in every column, or forgets to reduce the next column after borrowing.', 'OPS', 'Rewrite the top number with the regrouped digits and check each column: can the bottom digit be taken from the top digit?'),
  ('FRACTION_DENOMINATOR_CONFUSION', 'Denominator confusion', 'Adds or subtracts denominators as well as numerators, or thinks a bigger denominator means a bigger fraction.', 'NUM', 'Show equal parts of the same whole with a fraction strip; the denominator names the size of the parts, so it is not added.'),
  ('DECIMAL_PLACE_CONFUSION', 'Decimal place confusion', 'Misplaces the decimal point, or compares decimals as if they were whole numbers (thinks 0.35 is bigger than 0.4).', 'NUM', 'Line the numbers up in a place-value chart with tenths, hundredths and thousandths, and compare column by column from the left.'),
  ('UNIT_CONVERSION_ERROR', 'Unit conversion error', 'Multiplies or divides by the wrong power of ten (or the wrong way round) when changing between metric units.', 'MEA', 'Decide first whether the new unit is bigger or smaller (so should the number be bigger or smaller?), then use the conversion fact.'),
  ('TIME_CONVERSION_ERROR', 'Time conversion error', 'Treats time as decimal (100 minutes in an hour) or confuses 12-hour and 24-hour clock times.', 'MEA', 'Use a number line or clock face with 60-minute hours; for 24-hour times count on from 12.'),
  ('AREA_VS_PERIMETER', 'Area and perimeter confused', 'Finds the distance around a shape when asked for the space inside it, or the other way round.', 'MEA', 'Contrast them physically: perimeter is a fence around a field (length), area is the grass inside (squares).'),
  ('ORDER_OF_OPERATIONS_ERROR', 'Order of operations error', 'Works strictly left to right, ignoring that multiplication and division come before addition and subtraction.', 'OPS', 'Underline the multiplication or division first, work it out, then do the additions and subtractions; brackets come before everything.'),
  ('GRAPH_READING_ERROR', 'Graph or table reading error', 'Reads the wrong bar, the wrong axis or the wrong scale step from a graph, or confuses a count with a category.', 'REL', 'Find the label first, follow the bar to the scale with a finger or ruler, and check what one step on the scale is worth.'),
  ('ZERO_PLACEHOLDER_ERROR', 'Zero as a placeholder missed', 'Leaves out a zero when writing a number from its words or expanded form (writes 405 for four thousand and five).', 'NUM', 'Say each place out loud (thousands, hundreds, tens, ones) and write a zero for every empty place.'),
  ('FRACTION_SIZE_BY_DENOMINATOR', 'Bigger denominator, bigger fraction', 'Believes 1/8 is larger than 1/4 because 8 is larger than 4.', 'NUM', 'Share the same whole into equal parts: more parts means smaller parts. Compare with fraction strips.'),
  ('ROUNDING_DIRECTION_ERROR', 'Rounding in the wrong direction', 'Rounds down when the next digit is 5 or more (or rounds up when it is below 5), or looks at the wrong digit.', 'NUM', 'Find the digit to its right: 5 or more rounds up, less than 5 stays. Mark the two possible answers on a number line.'),
  ('BASIC_FACT_ERROR', 'Basic fact error', 'Recalls a multiplication or addition fact incorrectly although the method used is right.', 'OPS', 'Rebuild the fact from one you know (double, add one more group, use 10×) and practise it in short rounds.'),
  ('DIVISION_REMAINDER_ERROR', 'Remainder mishandled', 'Ignores the remainder, or writes it as a decimal or in the wrong place, in a division.', 'OPS', 'Check by multiplying back and adding the remainder; ask what the remainder means in the story.'),
  ('OPERATION_CHOICE_ERROR', 'Wrong operation chosen', 'Chooses addition, subtraction, multiplication or division that does not fit the situation in a word problem.', null, 'Retell the story in your own words, draw it, and ask what is being joined, taken away, shared or repeated.'),
  ('HCF_LCM_CONFUSION', 'HCF and LCM confused', 'Finds a common multiple when asked for a common factor, or the other way round.', 'OPS', 'List factors (numbers that divide in) and multiples (numbers that come out in the times table) separately for each number.'),
  ('ANGLE_TYPE_CONFUSION', 'Angle types confused', 'Mixes up acute, right, obtuse and straight angles, or reads the wrong size from a turn.', 'MEA', 'Compare every angle with a right angle (a corner of a page): smaller is acute, bigger is obtuse.'),
  ('AVERAGE_CONFUSION', 'Mean, median or mode confused', 'Uses the wrong measure of the data (the most common value instead of the average, or the middle instead of the total shared out).', 'REL', 'Say what each word means in plain words: mode is the most common, median the middle one in order, mean is the total shared equally.')
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  topic_code = excluded.topic_code, remediation = excluded.remediation;

-- Mastery cannot be earned on easy questions alone, and a mastered objective is reviewed on a
-- growing schedule: the engine (src/lib/mastery/engine.ts) needs both facts stored with the record.
alter table public.learner_objective_mastery
  add column hard_correct integer not null default 0 check (hard_correct >= 0),
  add column review_stage smallint not null default 0 check (review_stage between 0 and 10);

-- A misconception tag on a question or an attempt must exist in the registry: structured tags are
-- only useful for targeted remediation if a typo cannot silently create a new one.
create function public.validate_misconception_tags() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_unknown text[];
begin
  select array_agg(t) into v_unknown
  from unnest(new.misconception_tags) as t
  where t not in (select code from public.misconceptions);
  if v_unknown is not null then
    raise exception 'unknown misconception tag(s): %', v_unknown using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger questions_validate_misconception_tags
  before insert or update of misconception_tags on public.questions
  for each row execute function public.validate_misconception_tags();
create trigger attempts_validate_misconception_tags
  before insert or update of misconception_tags on public.question_attempts
  for each row execute function public.validate_misconception_tags();

revoke execute on function public.validate_misconception_tags() from public, anon, authenticated;
