'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isShortsPath,
  getShortIdFromPath,
  isVideoNearEndSnapshot,
  didPlaybackLoop,
  didShortChange,
} = require('../content-logic.js');

test('Shorts 경로를 판별하고 영상 ID를 추출한다', () => {
  assert.equal(isShortsPath('/shorts/AbC_123-xyz'), true);
  assert.equal(isShortsPath('/shorts/AbC_123-xyz/'), true);
  assert.equal(isShortsPath('/watch'), false);
  assert.equal(isShortsPath('/shorts/'), false);

  assert.equal(getShortIdFromPath('/shorts/AbC_123-xyz'), 'AbC_123-xyz');
  assert.equal(getShortIdFromPath('/shorts/AbC_123-xyz/'), 'AbC_123-xyz');
  assert.equal(getShortIdFromPath('/watch'), null);
  assert.equal(getShortIdFromPath('/shorts/'), null);
});

test('재생 위치가 영상 끝의 임계값 안에 있는지 판별한다', () => {
  assert.equal(
    isVideoNearEndSnapshot({ duration: 10, currentTime: 9.85 }, 0.2),
    true,
  );
  assert.equal(
    isVideoNearEndSnapshot({ duration: 10, currentTime: 9.7 }, 0.2),
    false,
  );
});

test('유효하지 않은 duration은 near-end로 판정하지 않는다', () => {
  for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      isVideoNearEndSnapshot({ duration, currentTime: 0 }, 0.2),
      false,
    );
  }
  assert.equal(
    isVideoNearEndSnapshot({ duration: 10, currentTime: 11 }, 0.2),
    false,
  );
});

test('영상 끝에서 처음으로 돌아온 자연 반복을 감지한다', () => {
  assert.equal(
    didPlaybackLoop(
      {
        currentTime: 0.05,
        previousTime: 9.95,
        duration: 10,
        previousDuration: 10,
        isSeeking: false,
      },
      0.5,
    ),
    true,
  );
});

test('영상 중간의 수동 되감기는 반복으로 판정하지 않는다', () => {
  assert.equal(
    didPlaybackLoop(
      {
        currentTime: 0.05,
        previousTime: 5,
        duration: 10,
        previousDuration: 10,
        isSeeking: false,
      },
      0.5,
    ),
    false,
  );
});

test('탐색 중인 재생 위치 변화는 반복으로 판정하지 않는다', () => {
  assert.equal(
    didPlaybackLoop(
      {
        currentTime: 0.05,
        previousTime: 9.95,
        duration: 10,
        previousDuration: 10,
        isSeeking: true,
      },
      0.5,
    ),
    false,
  );
});

test('duration이 바뀐 경우에는 반복으로 판정하지 않는다', () => {
  assert.equal(
    didPlaybackLoop(
      {
        currentTime: 0.05,
        previousTime: 9.95,
        duration: 12,
        previousDuration: 10,
        isSeeking: false,
      },
      0.5,
    ),
    false,
  );
});

test('이전 재생 위치가 duration 범위를 벗어나면 반복으로 판정하지 않는다', () => {
  assert.equal(
    didPlaybackLoop(
      {
        currentTime: 0.05,
        previousTime: 11,
        duration: 10,
        previousDuration: 10,
        isSeeking: false,
      },
      0.5,
    ),
    false,
  );
});

test('Short ID가 실제로 달라졌을 때만 변경으로 판정한다', () => {
  assert.equal(didShortChange('short-a', 'short-b'), true);
  assert.equal(didShortChange('short-a', 'short-a'), false);
  assert.equal(didShortChange(null, 'short-b'), false);
  assert.equal(didShortChange('short-a', null), false);
});
