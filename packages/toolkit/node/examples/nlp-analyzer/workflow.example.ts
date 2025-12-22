import { createNLPAnalyzer } from '../../src/index.mjs';

// Define types for better type safety
interface Entity {
  text: string;
  label: string;
  confidence: number;
  start: number;
  end: number;
}

// Mock external systems for demonstration
const MockSystems = {
  TicketingSystem: {
    escalateTicket: (ticketId: string, options: any) => {
      console.log(`🎫 Escalated ticket ${ticketId}:`, options);
    },
  },

  NotificationService: {
    alertManagers: (message: any) => {
      console.log(`📧 Manager alert sent:`, message);
    },

    sendEmail: (to: string, subject: string, body: string) => {
      console.log(`📨 Email sent to ${to}: ${subject}`);
    },
  },

  CRMSystem: {
    updateCustomer: (customerId: string, data: any) => {
      console.log(`👤 Customer ${customerId} updated:`, data);
    },

    createFollowUpTask: (data: any) => {
      console.log(`📋 Follow-up task created:`, data);
    },
  },

  DatabaseSystem: {
    logAnalysis: (result: any) => {
      // Fix: Safely access nested properties
      const sentimentLabel =
        result?.tasks?.sentiment?.overall?.label || 'unknown';
      const entitiesCount = result?.tasks?.entities?.entities?.length || 0;

      console.log(`💾 Analysis logged to database:`, {
        documentId: result.documentId,
        sentiment: sentimentLabel,
        entitiesCount: entitiesCount,
        confidence: result.metadata?.confidence || 0,
        processingTime: result.metadata?.processingTime || 0,
      });
    },
  },

  ReportingSystem: {
    addToReport: (type: string, data: any) => {
      console.log(`📊 Added to ${type} report:`, data);
    },
  },
};

async function runWorkflowExamples() {
  console.log('🔄 Starting Workflow Integration Examples\n');

  // Example 1: Customer Service Automation
  console.log('📞 Example 1: Customer Service Automation\n');

  const customerServiceAnalyzer = createNLPAnalyzer({
    enableRetries: true,
    enableMonitoring: true,
    useWorkers: false, // 🔧 Disable workers to avoid ONNX Runtime thread safety issues
    workflowCallbacks: {
      onAnalysisComplete: async (result, document, config) => {
        const sentiment = result.tasks.sentiment?.overall;

        if (sentiment?.label === 'negative' && sentiment.score > 0.8) {
          // Auto-escalate negative feedback
          MockSystems.TicketingSystem.escalateTicket(document.metadata.id, {
            reason: 'High-confidence negative sentiment detected',
            priority: 'urgent',
            sentimentScore: sentiment.score,
          });

          // Alert management
          MockSystems.NotificationService.alertManagers({
            message: `Urgent customer issue detected: ${document.metadata.title}`,
            documentId: document.metadata.id,
            sentimentScore: sentiment.score,
          });
        }

        // Update CRM with sentiment data
        MockSystems.CRMSystem.updateCustomer(document.metadata.id, {
          lastSentiment: sentiment?.label,
          lastAnalysisDate: new Date().toISOString(),
        });
      },

      onBatchComplete: async (results, documents, config) => {
        // Generate daily sentiment report
        const sentimentSummary = results.reduce(
          (acc, result) => {
            const sentiment =
              result.tasks.sentiment?.overall.label || 'neutral';
            acc[sentiment] = (acc[sentiment] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        MockSystems.ReportingSystem.addToReport('daily-sentiment', {
          date: new Date().toISOString().split('T')[0],
          summary: sentimentSummary,
          totalDocuments: results.length,
        });
      },
    },
  });

  // Add workflow rules for customer service
  customerServiceAnalyzer.addWorkflowRule({
    id: 'high-value-customer-priority',
    name: 'High-Value Customer Priority',
    description: 'Prioritize feedback from high-value customers',
    condition: (result, document) => {
      return document.metadata.title?.includes('VIP') || false;
    },
    action: async (result, document, config) => {
      MockSystems.CRMSystem.createFollowUpTask({
        customerId: document.metadata.id,
        priority: 'high',
        reason: 'VIP customer feedback received',
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Due tomorrow
      });
    },
    priority: 10,
  });

  // Test customer service scenario
  const customerFeedback = [
    {
      content:
        "I'm extremely disappointed with your service. The product arrived damaged and customer support was unhelpful. This is unacceptable for a premium service.",
      metadata: {
        id: 'ticket-001',
        title: 'Customer Complaint',
        size: 120,
        format: 'text' as const,
      },
    },
    {
      content:
        'Amazing experience! The product exceeded my expectations and the delivery was super fast. Will definitely recommend to others.',
      metadata: {
        id: 'ticket-002',
        title: 'VIP Customer Review',
        size: 100,
        format: 'text' as const,
      },
    },
  ];

  const customerResults = await customerServiceAnalyzer.analyzeBatch(
    customerFeedback,
    { tasks: ['sentiment', 'entities'] },
  );

  console.log(
    `✅ Processed ${customerResults.length} customer feedback items\n`,
  );

  // Example 2: Financial Document Processing
  console.log('💰 Example 2: Financial Document Processing\n');

  const financialAnalyzer = createNLPAnalyzer({
    useWorkers: false, // 🔧 Disable workers for stability
    workflowCallbacks: {
      onAnalysisComplete: async (result, document, config) => {
        const entities = result.tasks.entities?.entities || [];
        const amounts = entities.filter((e: any) => e.text.includes('$'));

        // Flag high-value transactions
        const highValueTransactions = amounts.filter((amount: any) => {
          const value = parseFloat(amount.text.replace(/[$,]/g, ''));
          return value > 10000;
        });

        if (highValueTransactions.length > 0) {
          MockSystems.NotificationService.alertManagers({
            message: `High-value transaction detected in document ${document.metadata.id}`,
            amounts: highValueTransactions.map((t: any) => t.text),
            requiresApproval: true,
          });
        }

        // Log all financial analysis
        MockSystems.DatabaseSystem.logAnalysis({
          ...result,
          financialAmounts: amounts.map((a: any) => a.text),
          flagged: highValueTransactions.length > 0,
        });
      },
    },
  });

  const financialDoc = {
    content:
      "The quarterly report shows revenue of $2,500,000 with expenses totaling $1,800,000. A significant investment of $500,000 was made in new equipment. Additionally, there's a pending transaction of $15,000 that requires board approval.",
    metadata: {
      id: 'financial-report-q4',
      title: 'Q4 Financial Report',
      size: 200,
      format: 'text' as const,
    },
  };

  await financialAnalyzer.analyze(financialDoc.content, financialDoc.metadata, {
    tasks: ['entities'],
  });

  // Example 3: Content Moderation Pipeline
  console.log('🛡️ Example 3: Content Moderation Pipeline\n');

  const moderationAnalyzer = createNLPAnalyzer({
    useWorkers: false, // 🔧 Disable workers for stability
    workflowCallbacks: {
      onAnalysisStart: async (document, config) => {
        console.log(`🔍 Starting moderation for: ${document.metadata.id}`);
      },

      onAnalysisComplete: async (result, document, config) => {
        const sentiment = result.tasks.sentiment?.overall;
        const confidence = result.metadata.confidence;

        // Content moderation logic
        let moderationAction = 'approve';
        let reason = 'Content passed moderation';

        if (sentiment?.label === 'negative' && sentiment.score > 0.9) {
          moderationAction = 'review';
          reason = 'High-confidence negative sentiment';
        } else if (confidence < 0.6) {
          moderationAction = 'review';
          reason = 'Low analysis confidence';
        }

        console.log(
          `⚖️ Moderation decision for ${document.metadata.id}: ${moderationAction} (${reason})`,
        );

        if (moderationAction === 'review') {
          MockSystems.NotificationService.sendEmail(
            'moderation-team@company.com',
            `Content requires review: ${document.metadata.id}`,
            `Reason: ${reason}\nContent preview: ${document.content.substring(0, 100)}...`,
          );
        }
      },
    },
  });

  const contentItems = [
    {
      content:
        'This product is absolutely terrible! Worst purchase ever made. Complete waste of money and time.',
      metadata: {
        id: 'content-001',
        title: 'User Review',
        size: 80,
        format: 'text' as const,
      },
    },
    {
      content:
        'Great product! Really happy with the quality and fast shipping. Highly recommend to everyone.',
      metadata: {
        id: 'content-002',
        title: 'User Review',
        size: 85,
        format: 'text' as const,
      },
    },
  ];

  await moderationAnalyzer.analyzeBatch(contentItems, {
    tasks: ['sentiment', 'classification'],
  });

  // Show workflow statistics
  console.log('\n📊 Workflow Statistics:');
  console.log(
    'Customer Service Workflows:',
    customerServiceAnalyzer.getWorkflowStats(),
  );
  console.log(
    'Workflow Rules:',
    customerServiceAnalyzer
      .getWorkflowRules()
      .map((r) => ({ id: r.id, name: r.name, enabled: r.enabled })),
  );

  await customerServiceAnalyzer.dispose();
  await financialAnalyzer.dispose();
  await moderationAnalyzer.dispose();

  console.log('\n✅ Workflow examples completed');
}

// Example 4: Advanced Rule-Based Workflow
async function advancedWorkflowExample() {
  console.log('🎯 Advanced Rule-Based Workflow Example\n');

  const analyzer = createNLPAnalyzer({
    enableMonitoring: true,
    useWorkers: false, // 🔧 Disable workers for stability
    workflowCallbacks: {
      onResourceAlert: async (alert) => {
        console.log(`🚨 Resource Alert: ${alert.message} (${alert.value})`);

        if (alert.level === 'critical') {
          MockSystems.NotificationService.alertManagers({
            message: `Critical resource alert: ${alert.message}`,
            alertType: alert.type,
            value: alert.value,
            action: 'immediate_attention_required',
          });
        }
      },
    },
  });

  // Add multiple sophisticated rules
  analyzer.addWorkflowRule({
    id: 'multi-entity-documents',
    name: 'Multi-Entity Document Handler',
    description: 'Handle documents with multiple important entities',
    condition: (result, document) => {
      const entities = (result?.tasks?.entities?.entities || []) as Entity[];
      const importantEntities = entities.filter((e) =>
        ['PERSON', 'ORGANIZATION', 'LOCATION'].includes(e.label),
      );
      return importantEntities.length >= 2; // Lower threshold to trigger more easily
    },
    action: async (result, document, config) => {
      try {
        const entities = (result?.tasks?.entities?.entities || []) as Entity[];
        const summary = entities.reduce(
          (acc: Record<string, number>, entity) => {
            acc[entity.label] = (acc[entity.label] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

        console.log(
          `📋 Multi-entity document detected: ${document.metadata.id}`,
        );
        console.log(`   Entities found: ${entities.length}`);
        console.log(`   Summary:`, summary);

        MockSystems.DatabaseSystem.logAnalysis({
          documentId: document.metadata.id,
          type: 'multi-entity-document',
          entitySummary: summary,
          tasks: result.tasks,
          metadata: result.metadata,
          flagged: true,
        });
      } catch (error: Error | any) {
        console.error(`Error in multi-entity workflow:`, error.message);
      }
    },
    priority: 5,
  });

  analyzer.addWorkflowRule({
    id: 'sentiment-confidence-check',
    name: 'Sentiment Confidence Validator',
    description: 'Flag documents with uncertain sentiment analysis',
    condition: (result, document) => {
      const sentiment = result?.tasks?.sentiment?.overall;
      return sentiment && sentiment.score < 0.8; // Lower threshold to trigger more easily
    },
    action: async (result, document, config) => {
      try {
        const sentimentScore = result?.tasks?.sentiment?.overall?.score || 0;
        console.log(
          `⚠️ Low confidence sentiment analysis for ${document.metadata.id} (${(sentimentScore * 100).toFixed(1)}%)`,
        );

        MockSystems.ReportingSystem.addToReport('low-confidence-analysis', {
          documentId: document.metadata.id,
          sentimentScore: sentimentScore,
          sentimentLabel: result?.tasks?.sentiment?.overall?.label || 'unknown',
          timestamp: new Date().toISOString(),
        });
      } catch (error: Error | any) {
        console.error(`Error in sentiment confidence workflow:`, error.message);
      }
    },
    priority: 3,
  });

  // Test with sample document
  const testDoc = {
    content:
      'John Smith from Microsoft Corporation will be meeting with Jane Doe from Apple Inc. in Seattle next week. The discussion will involve partnerships between the companies and potential collaboration opportunities in the tech industry.',
    metadata: {
      id: 'business-meeting-001',
      title: 'Business Meeting Notes',
      size: 180,
      format: 'text' as const,
    },
  };

  try {
    console.log('📄 Analyzing test document with workflow rules...');

    const result = await analyzer.analyze(testDoc.content, testDoc.metadata, {
      tasks: ['sentiment', 'entities'],
      useCache: false,
    });

    console.log('✅ Analysis completed successfully');
    console.log(
      `📊 Found ${result.tasks.entities?.entities?.length || 0} entities`,
    );
    console.log(
      `😊 Sentiment: ${result.tasks.sentiment?.overall?.label || 'unknown'} (${((result.tasks.sentiment?.overall?.score || 0) * 100).toFixed(1)}%)`,
    );
  } catch (error: Error | any) {
    console.error('❌ Analysis failed:', error.message);
  }

  console.log('\n📊 Final Workflow Statistics:', analyzer.getWorkflowStats());

  await analyzer.dispose();
}

// Create a basic workflow example:
async function workflowExample() {
  console.log('🔄 Starting Workflow Example');

  // Create analyzer with workflow callbacks - modelsPath will use default
  const analyzer = createNLPAnalyzer({
    maxWorkers: 2,
    useWorkers: false,
    workflowCallbacks: {
      onAnalysisStart: async (document, config) => {
        console.log(`📋 Starting analysis of: ${document.metadata.title}`);
      },

      onAnalysisComplete: async (result, document, config) => {
        console.log(`✅ Completed analysis of: ${document.metadata.title}`);
        console.log(`   Processing time: ${result.metadata.processingTime}ms`);
      },

      onAnalysisError: async (error, document, config) => {
        console.error(`❌ Analysis failed for: ${document.metadata.title}`);
        console.error(`   Error: ${error.message}`);
      },
    },
  });

  try {
    const content = `
      Microsoft Corporation is excited to announce a new partnership
      with several technology companies. This collaboration will bring
      innovative solutions to customers worldwide.
    `;

    const metadata = {
      id: 'workflow-test',
      title: 'Partnership Announcement',
      size: content.length,
      format: 'text' as const,
    };

    console.log('📄 Running workflow-enabled analysis...');

    const result = await analyzer.analyze(content, metadata, {
      tasks: ['sentiment', 'entities'],
      useCache: false,
    });

    console.log('\n📊 Results:');
    console.log('Sentiment:', result.tasks.sentiment.overall.label);
    console.log('Entities found:', result.tasks.entities.entities.length);
  } catch (error: Error | any) {
    console.error('Analysis failed:', error.message);
  } finally {
    await analyzer.dispose();
    console.log('✅ Workflow example completed');
  }
}

// Run all examples
runWorkflowExamples()
  .then(() => {
    return advancedWorkflowExample();
  })
  .then(() => {
    return workflowExample();
  })
  .catch(console.error);
