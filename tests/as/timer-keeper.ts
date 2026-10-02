// The test plugin of tests/closures.test.ts: a timer another plugin does not touch.

setTimeout(() => console.log("the keeper's timer fired"), 1000);
