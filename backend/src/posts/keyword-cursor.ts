/**
 * How far a campaign's keyword cursor really moved on a run.
 *
 * The cursor advances by `perPost` BEFORE the run, one rotation slot per post the run
 * intends to make. Some of those slots never reach a product search result being published:
 * pacing skips them when the group — or, for a Pinterest-only campaign, the campaign itself —
 * already has a post booked in this cycle. The keyword in a skipped slot was not tried. It
 * was simply never given its turn.
 *
 * Advancing past it anyway is not a small inefficiency. Pacing skips by POSITION: the first
 * slot takes the free booking and every later slot finds it taken. So on a campaign whose
 * runs always overflow by one — every campaign on posts_per_run 1 while a seasonal window
 * adds its extra post, for one — the second slot is skipped on every run, and with the cursor
 * stepping two at a time over an even-length rotation, the second slot only ever lands on the
 * same half of the rotation. Those keywords are never published at all, and nothing reports
 * it: the run note says "1 דולגו (הקבוצה תפוסה)", which reads as routine.
 *
 * That is how the US Pinterest campaign spent the Halloween window publishing almost nothing
 * from its Halloween keywords while every switch was on.
 *
 * So the skipped slots are handed back after the run, and the next run starts with them. The
 * pre-run advance stays where it is: a run that throws before posting — every keyword dry,
 * say — must still move on, or the campaign retries the same dead batch forever.
 */
export function cursorGiveBack(perPost: number, skipped: number): number {
  const per = Math.max(0, Math.floor(Number(perPost) || 0));
  const skip = Math.max(0, Math.floor(Number(skipped) || 0));
  return Math.min(skip, per);
}
