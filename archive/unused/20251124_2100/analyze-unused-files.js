const fs = require('fs');
const path = require('path');

/**
 * Analyze repository for unused files, duplicates, and orphaned modules
 */

class UnusedFilesAnalyzer {
  constructor() {
    this.srcDir = path.join(__dirname, 'src');
    this.allFiles = [];
    this.importMap = new Map();
    this.exportMap = new Map();
    this.candidateUnused = [];
  }

  async analyze() {
    console.log('🔍 ANALYZING REPOSITORY FOR UNUSED FILES\n');
    console.log('=' .repeat(60));

    // Step 1: Collect all TypeScript/JavaScript files
    this.collectAllFiles();
    console.log(`📁 Found ${this.allFiles.length} TypeScript/JavaScript files`);

    // Step 2: Build import/export maps
    await this.buildDependencyMaps();
    console.log(`🔗 Built dependency maps for ${this.importMap.size} imports and ${this.exportMap.size} exports`);

    // Step 3: Find unused files
    this.findUnusedFiles();
    console.log(`❌ Found ${this.candidateUnused.length} candidate unused files`);

    // Step 4: Check for duplicates
    const duplicates = this.findDuplicates();
    console.log(`📋 Found ${duplicates.length} potential duplicate files`);

    // Step 5: Generate report
    this.generateReport(duplicates);
  }

  collectAllFiles() {
    const walkDir = (dir) => {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
          walkDir(fullPath);
        } else if (stat.isFile() && (file.endsWith('.ts') || file.endsWith('.js'))) {
          // Skip test files, config files, and index files for now
          if (!file.endsWith('.test.ts') && !file.endsWith('.test.js') &&
              !file.includes('config') && !file.includes('index')) {
            this.allFiles.push({
              path: fullPath,
              relativePath: path.relative(this.srcDir, fullPath),
              name: file,
              size: stat.size,
              modified: stat.mtime
            });
          }
        }
      }
    };

    walkDir(this.srcDir);
  }

  async buildDependencyMaps() {
    for (const file of this.allFiles) {
      try {
        const content = fs.readFileSync(file.path, 'utf8');

        // Extract imports
        const importMatches = content.match(/import\s+.*?\s+from\s+['"]([^'"]+)['"]/g) || [];
        for (const match of importMatches) {
          const importPath = match.match(/from\s+['"]([^'"]+)['"]/)[1];
          if (!this.importMap.has(importPath)) {
            this.importMap.set(importPath, []);
          }
          this.importMap.get(importPath).push(file.relativePath);
        }

        // Extract exports (simplified)
        const exportMatches = content.match(/export\s+(?:const|function|class|interface|type)\s+(\w+)/g) || [];
        for (const match of exportMatches) {
          const exportName = match.match(/export\s+(?:const|function|class|interface|type)\s+(\w+)/)[1];
          if (!this.exportMap.has(exportName)) {
            this.exportMap.set(exportName, []);
          }
          this.exportMap.get(exportName).push(file.relativePath);
        }

      } catch (error) {
        console.warn(`Warning: Could not read ${file.path}: ${error.message}`);
      }
    }
  }

  findUnusedFiles() {
    for (const file of this.allFiles) {
      const relativePath = file.relativePath;
      const isImported = Array.from(this.importMap.values()).some(importers =>
        importers.some(importer => importer !== relativePath)
      );

      if (!isImported) {
        // Check if it's a main entry point or special file
        const isEntryPoint = relativePath.includes('server.ts') ||
                           relativePath.includes('app.ts') ||
                           relativePath.includes('index.ts');

        // Check for deprecation comments
        let hasDeprecationComment = false;
        try {
          const content = fs.readFileSync(file.path, 'utf8');
          hasDeprecationComment = content.includes('@deprecated') ||
                                content.includes('DEPRECATED') ||
                                content.includes('deprecated');
        } catch (e) {}

        this.candidateUnused.push({
          path: relativePath,
          size: file.size,
          modified: file.modified,
          reason: isEntryPoint ? 'entry_point' :
                  hasDeprecationComment ? 'deprecated' :
                  'no_imports_found',
          risk: isEntryPoint ? 'high' : hasDeprecationComment ? 'medium' : 'low'
        });
      }
    }
  }

  findDuplicates() {
    const duplicates = [];
    const contentMap = new Map();

    for (const file of this.allFiles) {
      try {
        const content = fs.readFileSync(file.path, 'utf8');
        const key = this.getContentHash(content);

        if (contentMap.has(key)) {
          duplicates.push({
            original: contentMap.get(key),
            duplicate: file.relativePath,
            size: file.size
          });
        } else {
          contentMap.set(key, file.relativePath);
        }
      } catch (error) {}
    }

    return duplicates;
  }

  getContentHash(content) {
    // Simple hash for duplicate detection
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  generateReport(duplicates) {
    console.log('\n📋 UNUSED FILES ANALYSIS REPORT');
    console.log('=' .repeat(60));

    if (this.candidateUnused.length === 0) {
      console.log('✅ No unused files found!');
    } else {
      console.log('\nCANDIDATE UNUSED FILES:');
      console.log('Risk levels: LOW (safe to remove), MEDIUM (review needed), HIGH (critical)');

      const sorted = this.candidateUnused.sort((a, b) => {
        const riskOrder = { low: 0, medium: 1, high: 2 };
        return riskOrder[a.risk] - riskOrder[b.risk];
      });

      sorted.forEach((file, index) => {
        const riskIcon = file.risk === 'high' ? '🔴' :
                        file.risk === 'medium' ? '🟡' : '🟢';
        const size = (file.size / 1024).toFixed(1) + 'KB';
        const modified = file.modified.toISOString().split('T')[0];

        console.log(`${index + 1}. ${riskIcon} ${file.path}`);
        console.log(`   Size: ${size}, Modified: ${modified}, Reason: ${file.reason}`);
        console.log('');
      });
    }

    if (duplicates.length > 0) {
      console.log('\nPOTENTIAL DUPLICATES:');
      duplicates.forEach((dup, index) => {
        console.log(`${index + 1}. ${dup.duplicate} (duplicate of ${dup.original})`);
      });
    }

    console.log('\n🎯 RECOMMENDATIONS:');
    console.log('1. Review LOW risk files first - these are likely safe to archive');
    console.log('2. Test MEDIUM risk files by temporarily moving them');
    console.log('3. NEVER touch HIGH risk files without thorough testing');
    console.log('4. Run full test suite after any moves to ensure nothing breaks');
  }
}

// Run analysis
const analyzer = new UnusedFilesAnalyzer();
analyzer.analyze().catch(console.error);
