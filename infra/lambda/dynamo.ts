import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { EntityType, Item, Repo } from './core';

/** One table: partition key = entity type, sort key = id. Small enough to read a whole type at once. */
export function dynamoRepo(tableName: string): Repo {
  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}), { marshallOptions: { removeUndefinedValues: true } });
  const strip = ({ pk: _pk, sk: _sk, ...rest }: Record<string, unknown>) => rest as Item;
  return {
    async list(type: EntityType) {
      const items: Item[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const res = await doc.send(
          new QueryCommand({
            TableName: tableName,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': type },
            ExclusiveStartKey: start,
          }),
        );
        items.push(...(res.Items ?? []).map(strip));
        start = res.LastEvaluatedKey;
      } while (start);
      return items;
    },
    async get(type, id) {
      const res = await doc.send(new GetCommand({ TableName: tableName, Key: { pk: type, sk: id } }));
      return res.Item ? strip(res.Item) : undefined;
    },
    async put(type, item) {
      await doc.send(new PutCommand({ TableName: tableName, Item: { ...item, pk: type, sk: item.id } }));
    },
    async delete(type, id) {
      await doc.send(new DeleteCommand({ TableName: tableName, Key: { pk: type, sk: id } }));
    },
  };
}
