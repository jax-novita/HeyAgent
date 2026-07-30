import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractTabQueryFromMessage,
  rankTabsByQuery,
  tokenizeTabQuery,
} from "./browser-agent.js";

test("extractTabQueryFromMessage: я открыл тест по математике", () => {
  const q = extractTabQueryFromMessage(
    "я в Яндексе открыл тест по математике пройди его",
  );
  assert.match(q, /тест|матем/i);
  assert.doesNotMatch(q, /яндекс|открыл|пройди/i);
});

test("extractTabQueryFromMessage: не путает «в яндекс браузере» с названием вкладки", () => {
  const q = extractTabQueryFromMessage(
    "пройти тест по математике который я открыл в яндекс браузере",
  );
  assert.match(q, /тест|матем/i);
  assert.doesNotMatch(q, /яндекс|браузер/i);
});

test("tokenizeTabQuery drops filler words", () => {
  const toks = tokenizeTabQuery("я уже открыл тест по математике");
  assert.ok(toks.includes("тест"));
  assert.ok(toks.some((t) => t.startsWith("матем")));
  assert.ok(!toks.includes("открыл"));
});

test("rankTabsByQuery prefers test tab over Dzen", () => {
  const pages = [
    {
      id: "1",
      type: "page",
      title: "Дзен — главная",
      url: "https://dzen.ru/",
      webSocketDebuggerUrl: "ws://1",
    },
    {
      id: "2",
      type: "page",
      title: "Тест по математике. 5 класс",
      url: "https://onlinetestpad.com/ru/test/math5",
      webSocketDebuggerUrl: "ws://2",
    },
    {
      id: "3",
      type: "page",
      title: "Яндекс",
      url: "https://yandex.ru/",
      webSocketDebuggerUrl: "ws://3",
    },
  ];
  const ranked = rankTabsByQuery(pages, "тест по математике");
  assert.equal(ranked[0]?.page.id, "2");
  assert.ok((ranked[0]?.score ?? 0) > (ranked.find((r) => r.page.id === "1")?.score ?? 0));
});

test("rankTabsByQuery: feed penalty when looking for quiz", () => {
  const pages = [
    {
      id: "dzen",
      type: "page",
      title: "Дзен",
      url: "https://dzen.ru/news",
      webSocketDebuggerUrl: "ws://d",
    },
    {
      id: "test",
      type: "page",
      title: "Тест п…",
      url: "https://onlinetestpad.com/x",
      webSocketDebuggerUrl: "ws://t",
    },
  ];
  const ranked = rankTabsByQuery(pages, "пройди тест");
  assert.equal(ranked[0]?.page.id, "test");
});
