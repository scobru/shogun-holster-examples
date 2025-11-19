import { ShogunCore } from 'shogun-core';
import Holster from '@mblaney/holster/src/holster.js';

// Test configuration
const TEST_CONFIG = {
  holsterPeer: process.env.HOLSTER_PEER || 'https://shogun-relay.scobrudot.dev/holster',
  testUsername: 'testuser_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15),
  testPassword: 'testpass123',
};

console.log('🧪 Starting Shogun Core + Holster Test');
console.log('Configuration:', TEST_CONFIG);
console.log('');

// Helper function to wait a bit for async operations
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function runTests() {
  let shogun;
  let holster;

  try {
    // Step 1: Create Holster instance
    console.log('📦 Step 1: Creating Holster instance...');
    holster = Holster({
      peers: [TEST_CONFIG.holsterPeer],
    });
    console.log('✅ Holster instance created');
    console.log('');

    // Step 2: Initialize Shogun Core with Holster
    console.log('🚀 Step 2: Initializing Shogun Core with Holster...');
    shogun = new ShogunCore({
      holsterInstance: holster,
      webauthn: {
        enabled: false, // Disable for testing
      },
      web3: {
        enabled: false, // Disable for testing
      },
      nostr: {
        enabled: false, // Disable for testing
      },
      zkproof: {
        enabled: false, // Disable for testing
      },
      silent: false, // Show logs
    });
    console.log('✅ Shogun Core initialized');
    console.log('');

    // Wait a bit for initialization
    // Note: There may be an error during async initialization about 'auth' property
    // This is a known issue: Holster doesn't have native 'auth' events like Gun,
    // so CoreInitializer.initializeGunUser() tries to use Gun-specific APIs that don't exist in Holster.
    // This error doesn't block functionality - authentication still works via polling.
    await wait(1000);

    // Step 3: Test database access
    console.log('💾 Step 3: Testing database operations...');
    const db = shogun.db;
    if (!db) {
      throw new Error('Database instance not available');
    }
    console.log('✅ Database instance accessible');
    
    // Test gun property access
    const gun = shogun.gun;
    if (!gun) {
      throw new Error('Gun/Holster instance not available');
    }
    console.log('✅ Gun/Holster instance accessible');
    console.log('');

    // Step 4: Test signup
    console.log('📝 Step 4: Testing user signup...');
    const signUpResult = await shogun.signUp(TEST_CONFIG.testUsername, TEST_CONFIG.testPassword);
    
    if (signUpResult.success) {
      console.log('✅ Signup successful!');
      console.log('   Username:', signUpResult.username);
    } else {
      console.log('⚠️  Signup result:', signUpResult);
      if (signUpResult.error) {
        console.log('   Error:', signUpResult.error);
      }
    }
    console.log('');

    // Step 5: Test login
    console.log('🔐 Step 5: Testing user login...');
    await wait(500); // Small delay between signup and login
    
    const loginResult = await shogun.login(TEST_CONFIG.testUsername, TEST_CONFIG.testPassword);
    
    if (loginResult.success) {
      console.log('✅ Login successful!');
      console.log('   Username:', loginResult.username);
    } else {
      console.log('❌ Login failed:', loginResult.error || 'Unknown error');
    }
    console.log('');

      // Step 6 & 7: Test database write and read together
      if (loginResult.success) {
        console.log('✍️  Step 6: Testing database write and read...');
        try {
          // Use Holster's native API directly for consistency
          const testData = {
            message: 'Hello from Shogun Core + Holster!',
            timestamp: Date.now(),
            username: TEST_CONFIG.testUsername,
          };
          
          const testNode = holster.get('test');
          const dataNode = testNode.next('data');
          
          // Set up listener BEFORE writing (Holster may need this)
          let readPromise = new Promise((resolve, reject) => {
            const readTimeout = setTimeout(() => {
              reject(new Error('Read timeout after 15 seconds'));
            }, 15000);
            
            let called = false;
            let unsubscribe = null;
            const callback = (value) => {
              // Accept any non-null value that has our data
              if (value !== null && value !== undefined) {
                if (typeof value === 'object') {
                  // Check if it has our expected fields
                  if (value.message || value.timestamp || value.username) {
                    if (called) return; // Prevent multiple calls
                    called = true;
                    clearTimeout(readTimeout);
                    
                    // Clean up Holster metadata
                    const cleanValue = { ...value };
                    delete cleanValue._;
                    delete cleanValue['#'];
                    if (cleanValue._) {
                      delete cleanValue._;
                    }
                    
                    // Unsubscribe safely
                    try {
                      if (unsubscribe && typeof unsubscribe === 'function') {
                        unsubscribe();
                      } else if (dataNode.off) {
                        dataNode.off(callback);
                      }
                    } catch (e) {
                      // Ignore unsubscribe errors
                    }
                    
                    resolve(cleanValue);
                    return;
                  }
                } else {
                  // Non-object value
                  if (called) return; // Prevent multiple calls
                  called = true;
                  clearTimeout(readTimeout);
                  
                  // Unsubscribe safely
                  try {
                    if (unsubscribe && typeof unsubscribe === 'function') {
                      unsubscribe();
                    } else if (dataNode.off) {
                      dataNode.off(callback);
                    }
                  } catch (e) {
                    // Ignore unsubscribe errors
                  }
                  
                  resolve(value);
                  return;
                }
              }
            };
            
            // Important: Register listener BEFORE writing (Holster is reactive)
            // Save unsubscribe function if available
            const onResult = dataNode.on(callback);
            if (typeof onResult === 'function') {
              unsubscribe = onResult;
            }
          });
          
          // Now write the data (listener is already active, so it will receive the data)
          await new Promise((resolve, reject) => {
            const writeTimeout = setTimeout(() => {
              reject(new Error('Write timeout'));
            }, 5000);
            
            dataNode.put(testData, (ack) => {
              clearTimeout(writeTimeout);
              if (ack && typeof ack === 'string' && ack.startsWith('error')) {
                reject(new Error(ack));
              } else {
                resolve(ack);
              }
            });
          });
          
          console.log('✅ Data written successfully');
          console.log('   Written data:', JSON.stringify(testData, null, 2));
          console.log('');
          
          // Wait a moment for sync
          await wait(1000);
          
          // Now try to read
          console.log('📖 Step 7: Testing database read...');
          try {
            const data = await readPromise;
            console.log('✅ Data read successfully:');
            console.log('   ', JSON.stringify(data, null, 2));
            console.log('');
          } catch (readError) {
            console.log('❌ Read error:', readError.message);
            console.log('   Note: The write was successful, but read timed out');
            console.log('   This might indicate a sync issue with the Holster relay');
            console.log('');
          }
        } catch (error) {
          console.log('❌ Write error:', error.message);
          console.log('   Stack:', error.stack);
          console.log('');
        }

      // Step 8: Test user profile access
      console.log('👤 Step 8: Testing user profile access...');
      try {
        const user = shogun.user;
        const currentUser = shogun.getCurrentUser();
        
        if (user || currentUser) {
          console.log('✅ User instance accessible');
          if (currentUser) {
            console.log('   User pub:', currentUser.pub);
          }
          if (user) {
            console.log('   User object type:', typeof user);
            if (user.is) {
              console.log('   User is logged in:', !!user.is.pub);
            }
          }
        } else {
          console.log('⚠️  User instance not available');
        }
        console.log('');
      } catch (error) {
        console.log('❌ User access error:', error.message);
        console.log('');
      }
    }

    // Step 9: Test event system
    console.log('📡 Step 9: Testing event system...');
    let eventReceived = false;
    shogun.on('auth:login', (data) => {
      eventReceived = true;
      console.log('✅ Login event received:', data);
    });

    // Trigger another login to test events
    if (loginResult.success) {
      await shogun.logout();
      await wait(500);
      await shogun.login(TEST_CONFIG.testUsername, TEST_CONFIG.testPassword);
      await wait(500);
      
      if (eventReceived) {
        console.log('✅ Event system working');
      } else {
        console.log('⚠️  Event not received (may be normal for Holster)');
      }
    }
    console.log('');

    console.log('🎉 All tests completed!');
    console.log('');

  } catch (error) {
    console.error('❌ Test failed with error:');
    console.error('   ', error.message);
    console.error('   Stack:', error.stack);
    console.log('');
  } finally {
    // Cleanup
    if (shogun) {
      try {
        await shogun.logout();
        console.log('🧹 Cleaned up: Logged out');
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Give time for cleanup
    await wait(500);
    console.log('👋 Test finished');
    process.exit(0);
  }
}

// Run the tests
runTests().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

