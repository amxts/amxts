#!/usr/bin/env node
// The amxts command a project runs: `npx amxts --help`. The command is its own
// package, @amxts/cli, which the core depends on; a package manager links the
// bins of a project's own dependencies only, so the core carries this one.
// The command finds the project's core again and drives it through
// @amxts/core/cli-api.
import process from 'node:process';
import { main } from '@amxts/cli';

main(process.argv.slice(2));
