export const steps = [
  {
    kind: "tool",
    name: "chat_post",
    arguments: {
      blocks: [
        {
          kind: "choice",
          choiceId: "color",
          question: "Which colour?",
          options: [
            { id: "oak", label: "Oak" },
            { id: "walnut", label: "Walnut" },
          ],
        },
      ],
    },
  },
  { kind: "text", text: "Pick one." },
];
