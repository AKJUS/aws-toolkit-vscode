/*!
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode'
import * as nls from 'vscode-nls'
import { CloudFormationClient } from '../../../shared/clients/cloudFormation'
import { AWSTreeNodeBase } from '../../../shared/treeview/nodes/awsTreeNodeBase'
import { PlaceholderNode } from '../../../shared/treeview/nodes/placeholderNode'
import { makeChildrenNodes } from '../../../shared/treeview/utils'
import { toArrayAsync, updateInPlace } from '../../../shared/utilities/collectionUtils'
import { ResourceTypeNode } from './resourceTypeNode'
import { CloudControlClient } from '../../../shared/clients/cloudControl'
import { memoizedGetResourceTypes, ResourceTypeMetadata } from '../../model/resources'
import { ResourcesSettings } from '../../commands/configure'
import { TypeSummary } from '@aws-sdk/client-cloudformation'

const localize = nls.loadMessageBundle()

export class ResourcesNode extends AWSTreeNodeBase {
    private readonly resourceTypeNodes: Map<string, ResourceTypeNode>

    public constructor(
        public readonly region: string,
        public readonly cloudFormation: CloudFormationClient = new CloudFormationClient(region),
        private readonly cloudControl: CloudControlClient = new CloudControlClient(region),
        private readonly settings = new ResourcesSettings()
    ) {
        super(localize('AWS.explorerNode.resources.label', 'Resources'), vscode.TreeItemCollapsibleState.Collapsed)
        this.resourceTypeNodes = new Map<string, ResourceTypeNode>()
        this.contextValue = 'resourcesRootNode'
    }

    public override async getChildren(): Promise<AWSTreeNodeBase[]> {
        return await makeChildrenNodes({
            getChildNodes: async () => {
                await this.updateChildren()
                return [...this.resourceTypeNodes.values()]
            },
            getNoChildrenPlaceholderNode: async () => {
                const placeholder = new PlaceholderNode(
                    this,
                    localize('AWS.explorerNode.resources.noResourceTypes', '[Enable resource types...]')
                )
                placeholder.command = {
                    title: localize('AWS.command.resources.configure', 'Show Resources....'),
                    command: 'aws.resources.configure',
                    arguments: [this],
                }
                return placeholder
            },
            sort: (nodeA: ResourceTypeNode, nodeB: ResourceTypeNode) => nodeA.typeName.localeCompare(nodeB.typeName),
        })
    }

    public async updateChildren(): Promise<void> {
        const resourceTypes = memoizedGetResourceTypes()
        const enabledResources = this.settings.get('enabledResources', [])

        // Use the most recently update type definition per-type
        const types = await toArrayAsync(this.cloudFormation.listTypes())
        types.sort((a, b) => (a.LastUpdated?.getTime() ?? 0) - (b.LastUpdated?.getTime() ?? 0))

        const availableTypes: Map<string, TypeSummary> = new Map()
        for (const type of types) {
            if (type.TypeName) {
                availableTypes.set(type.TypeName!, type)
            }
        }

        updateInPlace(
            this.resourceTypeNodes,
            enabledResources,
            (key) => this.resourceTypeNodes.get(key)!.clearChildren(),
            (key) => {
                const metadata = resourceTypes.get(key) ?? ({} as ResourceTypeMetadata)
                metadata.available = availableTypes.has(key)
                return new ResourceTypeNode(this, key, this.cloudControl, metadata)
            }
        )
    }
}
