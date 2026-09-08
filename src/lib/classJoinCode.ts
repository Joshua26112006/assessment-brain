import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * Class join codes: the short string a teacher reads out (or writes on a
 * board) and a student types once to enrol themselves.
 *
 * The alphabet deliberately excludes characters that are misread when copied
 * off a whiteboard or a screen — O/0, I/1/L, and the vowels that let a code
 * spell an unintended word. A student who mistypes a code doesn't get a
 * helpful error, they get "class not found", so the cheapest fix is to make
 * the codes hard to mistype in the first place.
 *
 * Codes are generated randomly rather than derived from the class name or id:
 * a guessable code would let anyone enrol themselves into a class they were
 * never given.
 */

const ALPHABET = "23456789BCDFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 6;

/**
 * How many times to retry on a unique-constraint collision. With 28^6 (~4.8e8)
 * possible codes a collision is already vanishingly unlikely; retrying a few
 * times means even an unlucky one resolves itself rather than failing the
 * teacher's request.
 */
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  // randomInt over the alphabet, not modulo of a random byte — modulo would
  // bias the earlier characters, and there is no reason to accept a skewed
  // distribution in something whose only job is being unguessable.
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return code;
}

/** Accepts what a student actually types: lower case, stray spaces, dashes. */
export function normalizeJoinCode(input: string): string {
  return input.trim().toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Returns this class's join code, creating one if it doesn't have it yet.
 *
 * Generating on demand rather than backfilling every class up front means a
 * class made before self-enrolment existed simply gets a code the first time
 * anyone needs it, and classes nobody enrols into never acquire one.
 */
export async function ensureClassJoinCode(classId: string): Promise<string | null> {
  const existing = await prisma.class.findUnique({
    where: { id: classId },
    select: { joinCode: true },
  });
  if (!existing) return null;
  if (existing.joinCode) return existing.joinCode;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = generateCode();
    try {
      // Conditional on joinCode still being null, so two concurrent requests
      // for the same class cannot overwrite each other's code — the loser
      // updates nothing and reads back whichever code actually won.
      const updated = await prisma.class.updateMany({
        where: { id: classId, joinCode: null },
        data: { joinCode: candidate },
      });
      if (updated.count === 1) return candidate;

      const current = await prisma.class.findUnique({
        where: { id: classId },
        select: { joinCode: true },
      });
      if (current?.joinCode) return current.joinCode;
    } catch {
      // Unique collision with another class — try a different code.
    }
  }

  return null;
}
