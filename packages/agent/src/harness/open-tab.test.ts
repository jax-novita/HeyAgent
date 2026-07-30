import { test } from "node:test";
import assert from "node:assert/strict";
import { wantsQuizSolve, detectOpenTabIntent } from "./open-tab.js";

test("wantsQuizSolve: пройти тест", () => {
  assert.equal(wantsQuizSolve("пройти тест по математике который я открыл"), true);
  assert.equal(wantsQuizSolve("пройди этот тест"), true);
  assert.equal(wantsQuizSolve("просто открой вкладку"), false);
});

test("wantsQuizSolve: bare continue from phone", async () => {
  assert.equal(wantsQuizSolve("Пройди!!!!"), true);
  assert.equal(wantsQuizSolve("Так ответь"), true);
  assert.equal(wantsQuizSolve("продолжи"), true);
  const { isQuizContinueIntent } = await import("./quiz-memory.js");
  assert.equal(isQuizContinueIntent("Пройди!!!!"), true);
  assert.equal(isQuizContinueIntent("Так ответь"), true);
  assert.equal(isQuizContinueIntent("ответь алексу привет"), false);
});

test("detectOpenTabIntent: open + take test", () => {
  assert.equal(
    detectOpenTabIntent("пройти тест по математике который я открыл в яндекс браузере"),
    true,
  );
});

test("heuristicMatchingValues: дроби", async () => {
  const { heuristicMatchingValues } = await import("./vision-desk.js");
  const page = `
Установите соответствие
Десятичная дробь
Смешанное число
Правильная дробь
Неправильная дробь
1 5 1/3
2 1/8
3 31/28
4 1,88
`;
  assert.deepEqual(heuristicMatchingValues(page), ["4", "1", "2", "3"]);
});

test("heuristicTextAnswer: 14x - _x = 6x → 8", async () => {
  const { heuristicTextAnswer } = await import("./open-tab.js");
  assert.equal(heuristicTextAnswer("Что нужно вставить в пропуск? 14x - _x = 6x"), "8");
  assert.equal(heuristicTextAnswer("14x − _x = 6x"), "8");
});

test("heuristicSmallestFraction: 2/7 меньше 3/6", async () => {
  const { heuristicSmallestFraction } = await import("./open-tab.js");
  assert.equal(
    heuristicSmallestFraction(["3/6", "5/6", "2/7", "2/6"]),
    3,
  );
});
