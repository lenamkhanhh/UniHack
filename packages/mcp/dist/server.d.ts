import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
export declare const missionsAbi: {
    readonly name: "missions";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "missionId";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
        readonly name: "id";
    }, {
        readonly type: "address";
        readonly name: "agent";
    }, {
        readonly type: "uint256";
        readonly name: "cap";
    }, {
        readonly type: "uint256";
        readonly name: "expiresAt";
    }, {
        readonly type: "bool";
        readonly name: "exists";
    }, {
        readonly type: "bool";
        readonly name: "closed";
    }];
};
export declare const missionPayeeRootAbi: {
    readonly name: "missionPayeeRoot";
    readonly type: "function";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly type: "bytes32";
        readonly name: "missionId";
    }];
    readonly outputs: readonly [{
        readonly type: "bytes32";
    }];
};
export declare function createMissionPayMcpServer(): McpServer;
//# sourceMappingURL=server.d.ts.map