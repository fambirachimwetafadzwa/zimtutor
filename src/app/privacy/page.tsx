import { CardPage } from "@/components/layout/PageShell";

export const metadata = { title: "How we protect learners" };

/*
 * Plain-language summary of what the product actually does. It must be kept in step with the
 * code (the database schema and the privacy tests), and reviewed by the operator's legal adviser
 * before launch: it is not legal advice and does not name a data controller or contact address.
 */
export default function PrivacyPage() {
  const promises = [
    "Learners never need an email address. A parent or guardian creates their account.",
    "We keep only a first name or nickname, a username, the grade, and the learner's maths progress.",
    "We never collect location. We never ask for a phone number, home address, photograph or school.",
    "Learners cannot message other people, and the tutor never shares or asks for contact details.",
    "Tutoring conversations are private to the learner. Parents see progress — topics, accuracy and what to practise — not the conversation itself.",
    "A parent can delete a learner's account at any time, from the learner's page. That removes the account and everything saved about it: progress, lessons, questions asked, answers and practice papers. A parent can also delete their own account, which removes the accounts of the learners they alone look after.",
    "There is no advertising, and we do not sell or share learner information.",
    "If the people who run ZimTutor turn on error reports or usage counts, those hold no names, usernames, email addresses, messages or answers: only counts, kinds of error and which part of the app.",
    "Sign-in guesses, questions and practice papers are counted so that a script or someone guessing passwords can be slowed down. The counts are kept scrambled, so they do not name anyone.",
    "The tutor is an AI. It can make mistakes, so every answer is marked by our own maths checker, not by the AI.",
    "ZimTutor scores are practice scores. They are never official ZIMSEC results.",
  ];
  return (
    <CardPage
      title="How we protect learners"
      intro="ZimTutor is made for primary-school children, so we collect as little as we can."
    >
      <ul className="flex list-disc flex-col gap-3 pl-6 text-lg">
        {promises.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </CardPage>
  );
}
