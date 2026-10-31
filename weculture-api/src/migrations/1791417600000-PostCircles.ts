import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

/**
 * Only the old school visibility is an authoritative circle classification.
 * The platform samples (fan workshop, campus tea, graduation ink exhibition,
 * paper cutting and architecture) were reviewed: their source does not establish
 * an actual city, content language or school. They intentionally stay null.
 * Their old discovery visibility and all moderation/submission data are retained.
 */
export class PostCircles1791417600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('posts');
    const columns = [
      new TableColumn({ name: 'circle', type: 'varchar', length: '20', isNullable: true }),
      new TableColumn({ name: 'city', type: 'varchar', length: '50', isNullable: true }),
      new TableColumn({ name: 'contentLanguage', type: 'varchar', length: '20', isNullable: true }),
    ].filter((column) => !table?.findColumnByName(column.name));
    if (columns.length) await queryRunner.addColumns('posts', columns);
    await queryRunner.query("UPDATE posts SET circle = 'campus' WHERE visibility = 'school' AND circle IS NULL");
    for (const index of [
      new TableIndex({ name: 'IDX_posts_circle_status_city_createdAt', columnNames: ['circle', 'status', 'city', 'createdAt'] }),
      new TableIndex({ name: 'IDX_posts_circle_schoolId_status_createdAt', columnNames: ['circle', 'schoolId', 'status', 'createdAt'] }),
    ]) if (!table?.indices.some((existing) => existing.name === index.name)) await queryRunner.createIndex('posts', index);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropIndex('posts', 'IDX_posts_circle_schoolId_status_createdAt');
    await queryRunner.dropIndex('posts', 'IDX_posts_circle_status_city_createdAt');
    await queryRunner.dropColumns('posts', ['circle', 'city', 'contentLanguage']);
  }
}
