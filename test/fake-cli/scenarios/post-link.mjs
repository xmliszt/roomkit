export const steps = ({ prompt }) => [
  {
    kind: "tool",
    name: "chat_post",
    arguments: {
      blocks: [
        {
          kind: "link",
          url: /https?:\/\/\S+/.exec(prompt)?.[0] ?? "https://example.test/",
          domain: "fake.test",
        },
      ],
    },
  },
  { kind: "text", text: "Here is the page." },
];
