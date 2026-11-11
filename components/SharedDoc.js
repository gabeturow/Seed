"use client";
import { useRef } from "react";
import { DocActions, DocBody } from "@/components/AnswerDoc";

// A shared answer, read-only, with copy / Word / PDF.
export default function SharedDoc({ doc }) {
  const card = useRef(null);
  return (
    <article className="card answer" ref={card}>
      <DocBody doc={doc} scope="s-" />
      <DocActions doc={doc} canShare={false} printRef={card} />
    </article>
  );
}
