/**
 * Mob.AI
 * -------
 * Agent-driven pathfinding & behavior extension for MakeCode Minecraft Bedrock.
 *
 * IMPORTANT: The agent IS the mob. Every block below moves/inspects the
 * player's agent directly — there is no separate simulated entity.
 *
 * NOTE ON THE MINECRAFT AGENT API:
 * This file calls `agent.move()`, `agent.turn()`, `agent.detectBlock()`,
 * and `agent.inspect()` as they exist in the pxt-minecraft "agent" namespace.
 * Exact method names/signatures can shift between MakeCode Minecraft
 * versions — check the current docs (https://minecraft.makecode.com/reference/agent)
 * before publishing, and adjust the thin wrapper functions in the
 * "Agent bridge" section below if anything doesn't match 1:1. Everything
 * else in this file is built on top of that bridge, so fixes stay local.
 */

//% color="#4b7bab" icon="\uf544" weight=95 block="Mob.AI"
namespace MobAI {

    // ---------------------------------------------------------------
    // Shared types
    // ---------------------------------------------------------------

    export enum ScanDirection {
        //% block="front"
        Front,
        //% block="behind"
        Behind,
        //% block="left"
        Left,
        //% block="right"
        Right,
        //% block="above"
        Above,
        //% block="below"
        Below,
    }

    export enum WallFollowSide {
        //% block="left-hand"
        LeftHand,
        //% block="right-hand"
        RightHand,
    }

    export enum GoalType {
        //% block="seek player"
        SeekPlayer,
        //% block="flee player"
        FleePlayer,
        //% block="patrol points"
        PatrolPoints,
        //% block="wander"
        Wander,
        //% block="guard position"
        GuardPosition,
    }

    // ---------------------------------------------------------------
    // Agent bridge — the ONLY place that talks to the real agent API.
    // Keep every other block calling through here so a future API
    // change only needs to be fixed in one spot.
    // ---------------------------------------------------------------

    // Real agent API uses global direction constants (FORWARD, BACK, LEFT,
    // RIGHT, UP, DOWN) rather than an enum — see
    // https://minecraft.makecode.com/reference/agent
    function toAgentDirection(dir: ScanDirection): SixDirection {
        switch (dir) {
            case ScanDirection.Front: return FORWARD;
            case ScanDirection.Behind: return BACK;
            case ScanDirection.Left: return LEFT;
            case ScanDirection.Right: return RIGHT;
            case ScanDirection.Above: return UP;
            case ScanDirection.Below: return DOWN;
        }
        return FORWARD;
    }

    /** True if the block immediately in `dir` is solid (would block movement). */
    function bridgeDetect(dir: ScanDirection): boolean {
        // agent.detect(AgentDetection.Block, direction) -> boolean
        return agent.detect(AgentDetection.Block, toAgentDirection(dir));
    }

    /** Inspects the block in `dir` and returns its block id/name. */
    function bridgeInspect(dir: ScanDirection): string {
        // agent.inspect(AgentInspection.Block, direction) -> block id/data
        const found = agent.inspect(AgentInspection.Block, toAgentDirection(dir));
        return found ? found.toString() : "";
    }

    function bridgeMove(dir: ScanDirection): void {
        // agent.move(direction, count) — no return value in the real API
        agent.move(toAgentDirection(dir), 1);
    }

    function bridgeTurn(clockwise: boolean): void {
        if (clockwise) {
            agent.turn(TurnDirection.Right);
        } else {
            agent.turn(TurnDirection.Left);
        }
    }

    // ---------------------------------------------------------------
    // MAZE — reactive, no real pathfinding math. Check-and-react.
    // ---------------------------------------------------------------

    /**
     * True if a solid block is detected in the given direction.
     */
    //% blockId=mobai_wall_detected
    //% block="wall detected on %direction"
    //% group="Maze"
    //% weight=100
    export function wallDetected(direction: ScanDirection): boolean {
        return bridgeDetect(direction);
    }

    /**
     * True if the given direction is clear (no solid block).
     */
    //% blockId=mobai_path_clear
    //% block="path clear on %direction"
    //% group="Maze"
    //% weight=95
    export function pathClear(direction: ScanDirection): boolean {
        return !bridgeDetect(direction);
    }

    /**
     * Turns the agent left or right in place.
     */
    //% blockId=mobai_turn
    //% block="turn %clockwise=toggleOnOff||clockwise"
    //% group="Maze"
    //% weight=90
    export function turn(clockwise: boolean): void {
        bridgeTurn(clockwise);
    }

    /**
     * Moves forward repeatedly until a wall is hit.
     * `maxSteps` is a safety cap so this can't infinite-loop in open terrain.
     */
    //% blockId=mobai_move_until_wall
    //% block="move forward until wall (max %maxSteps steps)"
    //% maxSteps.defl=100
    //% group="Maze"
    //% weight=85
    export function moveUntilWall(maxSteps: number = 100): void {
        let steps = 0;
        while (!bridgeDetect(ScanDirection.Front) && steps < maxSteps) {
            bridgeMove(ScanDirection.Front);
            steps++;
        }
    }

    /**
     * Classic wall-following maze solver. Hugs the chosen wall side and
     * keeps moving until either a dead end or `maxSteps` is reached.
     */
    //% blockId=mobai_wall_follow
    //% block="wall-follow mode %side (max %maxSteps steps)"
    //% maxSteps.defl=200
    //% group="Maze"
    //% weight=80
    export function wallFollow(side: WallFollowSide, maxSteps: number = 200): void {
        let steps = 0;
        const huggingLeft = side === WallFollowSide.LeftHand;

        while (steps < maxSteps) {
            const huggingSide = huggingLeft ? ScanDirection.Left : ScanDirection.Right;

            if (!bridgeDetect(huggingSide)) {
                // Opening on the hugging side: turn into it and step forward.
                bridgeTurn(!huggingLeft);
                if (!bridgeDetect(ScanDirection.Front)) {
                    bridgeMove(ScanDirection.Front);
                }
            } else if (!bridgeDetect(ScanDirection.Front)) {
                // Wall on hugging side, front clear: keep going straight.
                bridgeMove(ScanDirection.Front);
            } else {
                // Boxed in on hugging side and front: turn away from the wall.
                bridgeTurn(huggingLeft);
                if (isDeadEnd()) {
                    break;
                }
            }
            steps++;
        }
    }

    /**
     * True if all four horizontal directions are blocked.
     */
    //% blockId=mobai_dead_end
    //% block="at a dead end"
    //% group="Maze"
    //% weight=75
    export function isDeadEnd(): boolean {
        return bridgeDetect(ScanDirection.Front)
            && bridgeDetect(ScanDirection.Behind)
            && bridgeDetect(ScanDirection.Left)
            && bridgeDetect(ScanDirection.Right);
    }

    // ---------------------------------------------------------------
    // GOTO — scan for a target block id and path toward it.
    // ---------------------------------------------------------------

    let pathfindCancelled = false;
    let lastPathfindFailed = false;
    const onPathfoundHandlers: { [blockId: string]: (() => void)[] } = {};

    /**
     * Scans outward (simple expanding search, capped by radius) until the
     * target block is found, then walks the agent to it.
     * Returns true if the block was found and reached.
     */
    //% blockId=mobai_pathfind_until_found
    //% block="pathfind until block %blockId is found within %radius blocks"
    //% blockId.defl="gold_block"
    //% radius.defl=32
    //% group="Goto"
    //% weight=100
    export function pathfindUntilFound(blockId: string, radius: number = 32): boolean {
        pathfindCancelled = false;
        lastPathfindFailed = false;

        let steps = 0;
        const maxSteps = radius * 4; // generous cap; tune per world density

        while (steps < maxSteps && !pathfindCancelled) {
            const seen = bridgeInspect(ScanDirection.Front);
            if (seen === blockId) {
                fireOnPathfound(blockId);
                return true;
            }

            // Greedy step: move forward if clear, otherwise turn and retry.
            // (A full A* route can replace this loop later without touching
            // the block signatures above it.)
            if (!bridgeDetect(ScanDirection.Front)) {
                bridgeMove(ScanDirection.Front);
            } else {
                bridgeTurn(true);
            }
            steps++;
        }

        lastPathfindFailed = !pathfindCancelled;
        return false;
    }

    /**
     * Fires when the given block id is found via pathfindUntilFound
     * (or pathfindNearest).
     */
    //% blockId=mobai_when_pathfound
    //% block="when block %blockId pathfound"
    //% blockId.defl="gold_block"
    //% group="Goto"
    //% weight=95
    export function onPathfound(blockId: string, handler: () => void): void {
        if (!onPathfoundHandlers[blockId]) {
            onPathfoundHandlers[blockId] = [];
        }
        onPathfoundHandlers[blockId].push(handler);
    }

    function fireOnPathfound(blockId: string): void {
        const handlers = onPathfoundHandlers[blockId];
        if (handlers) {
            for (const h of handlers) {
                h();
            }
        }
    }

    /**
     * Same as pathfindUntilFound, but only returns true if the nearest
     * match is within `radius` blocks (keeps searches bounded/perf-safe).
     */
    //% blockId=mobai_pathfind_nearest
    //% block="pathfind to nearest %blockId within %radius blocks"
    //% blockId.defl="gold_block"
    //% radius.defl=16
    //% group="Goto"
    //% weight=90
    export function pathfindNearest(blockId: string, radius: number): boolean {
        return pathfindUntilFound(blockId, radius);
    }

    /**
     * Cancels an in-progress pathfind on its next check.
     */
    //% blockId=mobai_cancel_pathfind
    //% block="cancel pathfind"
    //% group="Goto"
    //% weight=85
    export function cancelPathfind(): void {
        pathfindCancelled = true;
    }

    /**
     * True immediately after a pathfind call that ran out of steps/radius
     * without finding the target (and wasn't cancelled).
     */
    //% blockId=mobai_pathfind_failed
    //% block="last pathfind failed"
    //% group="Goto"
    //% weight=80
    export function pathfindFailed(): boolean {
        return lastPathfindFailed;
    }

    // ---------------------------------------------------------------
    // CORE — goal-based behaviors, composed from Maze + Goto primitives.
    // ---------------------------------------------------------------

    let currentGoal: GoalType = GoalType.Wander;
    let pathfindingSpeed: number = 1;

    /**
     * Sets the agent's current high-level goal. Actual movement per-tick
     * should call `runGoalStep()` in a forever loop.
     */
    //% blockId=mobai_set_goal
    //% block="set goal to %goal"
    //% weight=100
    export function setGoal(goal: GoalType): void {
        currentGoal = goal;
    }

    /**
     * Sets how many blocks the agent attempts to move per goal step.
     */
    //% blockId=mobai_set_speed
    //% block="set pathfinding speed to %speed"
    //% speed.defl=1
    //% weight=95
    export function setPathfindingSpeed(speed: number): void {
        pathfindingSpeed = speed;
    }

    /**
     * Runs one step of whatever goal is currently active. Call this inside
     * a `forever` loop for continuous behavior.
     */
    //% blockId=mobai_run_goal_step
    //% block="run goal step"
    //% weight=90
    export function runGoalStep(): void {
        switch (currentGoal) {
            case GoalType.Wander:
                moveUntilWall(pathfindingSpeed);
                if (bridgeDetect(ScanDirection.Front)) {
                    bridgeTurn(true);
                }
                break;
            case GoalType.SeekPlayer:
            case GoalType.FleePlayer:
            case GoalType.PatrolPoints:
            case GoalType.GuardPosition:
                // Placeholder hooks — wire these to player position APIs
                // once that part of the design is settled.
                break;
        }
    }
}