import test from 'node:test';
import assert from 'node:assert/strict';
import { newPalmStage, updatePalmStage } from '../app/logic/arGestures.ts';
test('opening and closing the palm moves through four stages in both directions', () => {
  const state = newPalmStage();
  for (const [value, expected, time] of [[1.45,1,0],[1.8,2,300],[2.2,3,600],[1.8,2,900],[1.45,1,1200],[1,0,1500]]) {
    updatePalmStage(state,value,time);
    assert.equal(updatePalmStage(state,value,time+170),expected);
  }
});
test('boundary jitter and brief detections do not change the stage', () => {
  const state = newPalmStage();
  updatePalmStage(state,1.5,0); updatePalmStage(state,1.5,170);
  for (let i=0;i<12;i++) assert.equal(updatePalmStage(state,i%2?1.62:1.68,200+i*50),1);
  updatePalmStage(state,2.3,900);
  updatePalmStage(state,null,1000);
  assert.equal(updatePalmStage(state,2.3,1100),1);
  assert.equal(updatePalmStage(state,2.3,1270),3);
});
