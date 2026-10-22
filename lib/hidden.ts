// Test promises kept out of the public list. They still open at /p/<id>.
// Remove an id here (or from HIDDEN_PROMISE_IDS) to show it again.
const TEST_PROMISES = [
  "a83dd254-1a22-4da1-963c-07abdaf947b7",
  "07251c55-0c5f-43ff-b620-12ebc9960ddf",
  "ec5dbc4a-b65d-4241-8f2a-fd6342cb9757",
  "b75923f9-70f9-4ca8-979c-1382c909d58e",
  "ee6f639b-128d-4248-97ed-93d4e7ef42a2",
  "fb7f38dd-8ef9-4414-a5ed-c8f303794227",
  "6601e22f-4a85-4ac2-9088-0d5d21168267",
  "4485fdb6-992a-471e-8ee4-b0b7855ba743",
  "6e7d59c2-812e-421b-9218-ad10df9c827b",
  "c0ec4602-d300-4dc5-8145-08a788e09512",
  "6f68c627-54b0-4bc0-a504-2eab5af40c67",
];

export function hiddenIds(env = process.env.HIDDEN_PROMISE_IDS): Set<string> {
  const extra = (env ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return new Set([...TEST_PROMISES, ...extra]);
}

export function visible<T extends { id: string }>(list: T[], hidden = hiddenIds()): T[] {
  return list.filter((p) => !hidden.has(p.id));
}
